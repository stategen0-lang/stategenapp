// Attaching photos to a listing over WhatsApp.
//
// After "add a listing" saves, applyPendingAction opens a "collecting_photos"
// window (conversation_state) tied to the new listing. Each photo is downloaded
// from Meta's media API, stored in the same bucket the web upload uses, and
// appended to the listing's Photos. Works inside WhatsApp's 24h service window.
//
// The window used to close on ANY text, so an agent who typed "ok" or "here are
// the pics" before sending them got "Sorry, I didn't understand that" for every
// photo. Now small talk keeps it open, "photos for #23" (or a "#23" caption)
// opens one for any listing they can edit, and a photo with no window gets told
// how to attach it instead of being read as a command.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '@/lib/whatsapp/write-handlers'
import { downloadMedia, type BotReply, type InboundMessage } from '@/lib/whatsapp/cloud'
import { storePhotoBytes } from '@/lib/upload-server'
import { canEditProperty } from '@/lib/permissions'
import {
  isPhotoDone, isPhotoChatter, parsePhotoTarget, parseCaptionTarget, appendPhoto, photoCount,
} from '@/lib/whatsapp/photo-intent'
import { offerMarketing } from '@/lib/whatsapp/marketing-handlers'

type Row = Record<string, unknown>
const WINDOW_MS = 24 * 3600_000
const FLOW = 'collecting_photos'
const HELP_FLOW = 'photo_help'
// Media we can't attach (a video, a voice note, a non-image file).
const OTHER_MEDIA = new Set(['video', 'audio', 'document', 'sticker'])

/** Silent: the webhook sends nothing for this reply (see route.ts). */
export const NO_REPLY = ''

function toSession(p: Profile) {
  return {
    userId: p.id, companyId: p.company_id, role: p.role as 'owner' | 'manager' | 'agent',
    agentCode: p.agent_code, fullName: p.Full_name ?? 'Agent', approved: true,
  }
}

function agentOf(row: Row): string | null {
  try { return (JSON.parse((row.Amenities as string) || '{}').agentId as string) ?? null } catch { return null }
}

async function openWindow(admin: SupabaseClient, profile: Profile, propertyId: number) {
  await admin.from('conversation_state').upsert({
    company_id: profile.company_id, profile_id: profile.id,
    current_flow: FLOW, step: 'photos',
    context: { propertyId }, updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' })
}

/** The listing, if it exists in this company and this agent may edit it. */
async function editableListing(admin: SupabaseClient, profile: Profile, id: number): Promise<Row | 'missing' | 'forbidden'> {
  const { data } = await admin
    .from('Properties').select('id, Title, Amenities, Photos')
    .eq('id', id).eq('company_id', profile.company_id).maybeSingle()
  if (!data) return 'missing'
  return canEditProperty(toSession(profile), agentOf(data as Row)) ? (data as Row) : 'forbidden'
}

/**
 * Append a stored photo URL to a listing. Several photos sent together arrive as
 * separate, parallel webhooks; a plain read-modify-write let them overwrite each
 * other and only one or two survived. Each write is conditional on Photos still
 * being what we read, and retried on a lost race.
 */
async function attach(admin: SupabaseClient, profile: Profile, propertyId: number, url: string): Promise<number | 'unreadable' | 'failed'> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: row } = await admin
      .from('Properties').select('Photos').eq('id', propertyId).eq('company_id', profile.company_id).maybeSingle()
    if (!row) return 'failed'
    const raw = (row as Row).Photos
    const next = appendPhoto(raw, url)
    if (!next.ok) return next.reason === 'duplicate' ? photoCount(raw) : 'unreadable'

    let q = admin.from('Properties').update({ Photos: next.json })
      .eq('id', propertyId).eq('company_id', profile.company_id)
    // The condition travels in the URL, so past a few KB (a listing with dozens
    // of photos) fall back to a plain write rather than risk an oversized request.
    const current = typeof raw === 'string' ? raw : null
    if (raw === null || raw === undefined) q = q.is('Photos', null)
    else if (current !== null && current.length <= 6000) q = q.eq('Photos', current)
    const { data: written, error } = await q.select('id')
    if (error) return 'failed'
    if (written && written.length) return next.count
    // Someone else's photo landed first — back off a little and re-read.
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120))
  }
  return 'failed'
}

async function savePhoto(admin: SupabaseClient, profile: Profile, propertyId: number, mediaId: string): Promise<string> {
  const dl = await downloadMedia(mediaId)
  if (!dl.ok) return `Couldn't fetch that photo — please resend it, or reply "done".`
  const up = await storePhotoBytes(admin, profile.company_id, dl.bytes)
  if (!up.ok) return `${up.error} Try another photo, or reply "done".`

  const n = await attach(admin, profile, propertyId, up.url)
  if (n === 'unreadable') return `#${propertyId}'s photo list couldn't be read, so I didn't change it. Add this photo on the web instead.`
  if (n === 'failed') return `Couldn't save that photo to #${propertyId} — please resend it.`
  await openWindow(admin, profile, propertyId)   // keep the window fresh
  return `📸 Photo ${n} saved to #${propertyId}. Send more, or reply "done".`
}

/**
 * A photo with nowhere to go. Say how to attach it — once: an album of ten
 * arrives as ten parallel webhooks, and ten identical replies is spam. The first
 * to claim the (unique per agent) conversation_state row answers; the rest stay
 * silent.
 */
async function strayPhoto(admin: SupabaseClient, profile: Profile): Promise<BotReply> {
  // Photos sent while the new listing is still waiting on YES.
  const { data: pending } = await admin
    .from('pending_actions').select('action_type')
    .eq('profile_id', profile.id).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const waitingOnYes = (pending as Row | null)?.action_type === 'create_property'

  const claim = await admin.from('conversation_state').insert({
    company_id: profile.company_id, profile_id: profile.id,
    current_flow: HELP_FLOW, step: 'photos', context: {}, updated_at: new Date().toISOString(),
  })
  if (claim.error?.code === '23505') {
    const { data: st } = await admin
      .from('conversation_state').select('current_flow, updated_at').eq('profile_id', profile.id).maybeSingle()
    const recentHelp = (st as Row | null)?.current_flow === HELP_FLOW
      && Date.now() - new Date(String((st as Row).updated_at)).getTime() < 60_000
    if (recentHelp) return NO_REPLY
  }

  if (waitingOnYes) {
    return 'Reply YES to save the listing first — then send the photos and I\'ll attach them to it.'
  }

  // Offer their latest listing as a one-tap target.
  const { data: rows } = await admin
    .from('Properties').select('id, Amenities')
    .eq('company_id', profile.company_id).order('id', { ascending: false }).limit(50)
  const latest = ((rows ?? []) as Row[]).find(r => canEditProperty(toSession(profile), agentOf(r)))
  const text = 'Which listing are these photos for? Send "photos for #<number>", then send the photos again.\n\nTip: a photo captioned with the listing number (e.g. "#23") is attached straight away.'
  if (!latest) return text
  return { text, buttons: [{ id: `photos_${latest.id}`, title: `Photos for #${latest.id}` }] }
}

export async function continuePhotoCollection(
  admin: SupabaseClient, profile: Profile, inbound: InboundMessage, origin: string,
): Promise<BotReply | null> {
  const { data: state } = await admin
    .from('conversation_state').select('current_flow, context, updated_at').eq('profile_id', profile.id).maybeSingle()
  const clear = () => admin.from('conversation_state').delete().eq('profile_id', profile.id)

  const flow = (state as Row | null)?.current_flow
  const fresh = !!state && Date.now() - new Date(String((state as Row).updated_at)).getTime() < WINDOW_MS
  if (flow === FLOW && !fresh) await clear()
  const open = flow === FLOW && fresh
  const windowId = open ? Number(((state as Row).context as Row | null)?.propertyId) || null : null
  const text = inbound.text.trim()

  // ── A photo ────────────────────────────────────────────────────────────────
  if (inbound.image) {
    const captioned = parseCaptionTarget(inbound.image.caption, { allowBareNumber: !windowId })
    const target = captioned ?? windowId
    if (!target) return strayPhoto(admin, profile)
    if (captioned && captioned !== windowId) {
      const listing = await editableListing(admin, profile, captioned)
      if (listing === 'missing') return `There's no listing #${captioned}. Check the number and resend the photo.`
      if (listing === 'forbidden') return `#${captioned} belongs to another agent, so I can't add photos to it.`
    }
    return savePhoto(admin, profile, target, inbound.image.id)
  }

  // ── "photos for #23": open (or switch) the window ─────────────────────────
  const target = parsePhotoTarget(text)
  if (target) {
    const listing = await editableListing(admin, profile, target)
    if (listing === 'missing') return `There's no listing #${target}. Check the number and try again.`
    if (listing === 'forbidden') return `#${target} belongs to another agent, so I can't add photos to it.`
    await openWindow(admin, profile, target)
    const have = photoCount(listing.Photos)
    return `📸 Send the photos for #${target} now (one or several)${have ? ` — it has ${have} already` : ''}. Reply "done" when finished.`
  }

  // A leftover "which listing?" marker: drop it and route this message normally.
  if (flow === HELP_FLOW) { await clear(); return null }
  if (!open || !windowId) return null

  // ── Inside an open window ─────────────────────────────────────────────────
  if (isPhotoDone(text)) {
    await clear()
    const { data: row } = await admin
      .from('Properties').select('Photos, Amenities').eq('id', windowId).eq('company_id', profile.company_id).maybeSingle()
    const n = photoCount((row as Row | null)?.Photos)
    const summary = n > 0
      ? `✅ #${windowId} now has ${n} photo${n === 1 ? '' : 's'}.`
      : `No photos added to #${windowId} — send "photos for #${windowId}" any time, or add them on the web.`

    // The listing is ready: offer to send it to the marketing team, unless it
    // already went (the agent can still send "send #45 to marketing" again).
    let alreadySent = false
    try { alreadySent = !!JSON.parse(String((row as Row | null)?.Amenities || '{}')).marketingSentAt } catch { /* treat as unsent */ }
    if (alreadySent) return summary
    const offer = await offerMarketing(admin, profile, windowId, origin, `${summary}

`)
    return offer ?? summary
  }

  if (OTHER_MEDIA.has(inbound.type)) {
    return `I can only attach photos here — add videos and documents on the web. Keep sending photos for #${windowId}, or reply "done".`
  }

  if (isPhotoChatter(text)) {
    await openWindow(admin, profile, windowId)
    return `👍 Go ahead — send the photos for #${windowId}, or reply "done".`
  }

  // Anything else is a real request: end the window and let it route normally.
  await clear()
  return null
}
