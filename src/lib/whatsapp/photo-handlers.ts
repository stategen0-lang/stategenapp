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
// opens one for any listing they can edit.
//
// A photo with no window is placed by context, not refused (24 Oct 2026: an
// album sent 27s after "send photos for #250" got "which listing? send them
// again" — an empty event at the head of the album had closed the window):
//   • the listing this conversation was just about (the last #number in the
//     last two hours, if the agent may edit it), else the one they added most
//     recently today → attached there, and the reply says where;
//   • the new listing still waiting on YES → held, attached when it's saved;
//   • no idea → held, and asked once. Naming the listing — "#250", the button,
//     "the Achrafieh one" to the agent — attaches what was already sent.
// Held photos are marked on their own whatsapp_logs row (one row per photo, so
// an album's parallel webhooks never race each other).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '@/lib/whatsapp/write-handlers'
import { downloadMedia, type BotReply, type InboundMessage } from '@/lib/whatsapp/cloud'
import { storePhotoBytes } from '@/lib/upload-server'
import { canEditProperty } from '@/lib/permissions'
import {
  isPhotoDone, isPhotoChatter, isPhotoRequest, parsePhotoCommand, parseCaptionTarget, appendPhoto, photoCount,
} from '@/lib/whatsapp/photo-intent'
import { offerMarketing } from '@/lib/whatsapp/marketing-handlers'
import { parseBareConfirmation } from '@/lib/whatsapp/replies'

type Row = Record<string, unknown>
const WINDOW_MS = 24 * 3600_000
const FLOW = 'collecting_photos'
const HELP_FLOW = 'photo_help'
// Set by listing-finder when an agent opens a listing (kept in step with it).
const FOCUS_FLOW = 'listing_focus'
const FOCUS_MS = 60 * 60_000
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

/** Fetching from WhatsApp and storing the bytes — swapped out in tests. */
export interface PhotoIO {
  download: typeof downloadMedia
  store: typeof storePhotoBytes
}
const REAL_IO: PhotoIO = { download: downloadMedia, store: storePhotoBytes }

type Saved = { ok: true; count: number } | { ok: false; reply: string }

async function storeAndAttach(admin: SupabaseClient, profile: Profile, propertyId: number, mediaId: string, io: PhotoIO): Promise<Saved> {
  const dl = await io.download(mediaId)
  if (!dl.ok) return { ok: false, reply: `Couldn't fetch that photo — please resend it, or reply "done".` }
  const up = await io.store(admin, profile.company_id, dl.bytes)
  if (!up.ok) return { ok: false, reply: `${up.error} Try another photo, or reply "done".` }
  const n = await attach(admin, profile, propertyId, up.url)
  if (n === 'unreadable') return { ok: false, reply: `#${propertyId}'s photo list couldn't be read, so I didn't change it. Add this photo on the web instead.` }
  if (n === 'failed') return { ok: false, reply: `Couldn't save that photo to #${propertyId} — please resend it.` }
  return { ok: true, count: n }
}

async function savePhoto(admin: SupabaseClient, profile: Profile, propertyId: number, mediaId: string, io: PhotoIO, note = ''): Promise<string> {
  const saved = await storeAndAttach(admin, profile, propertyId, mediaId, io)
  if (!saved.ok) return saved.reply
  await openWindow(admin, profile, propertyId)   // keep the window fresh
  return `📸 Photo ${saved.count} saved to #${propertyId}${note}. Send more, or reply "done".`
}

// ── Held photos ──────────────────────────────────────────────────────────────

const HOLD_MS = 2 * 3600_000
const held = (mediaId: string) => `📷 photo ${mediaId} — waiting for a listing`
const HELD_PATTERN = '📷 photo % — waiting for a listing'

/** Mark this photo's own log row as waiting for a listing. */
async function holdPhoto(admin: SupabaseClient, inbound: InboundMessage) {
  if (!inbound.image || !inbound.messageId) return
  await admin.from('whatsapp_logs').update({ message: held(inbound.image.id) }).eq('wa_message_id', inbound.messageId)
}

/**
 * Attach every photo this agent sent in the last two hours that is still
 * waiting for a listing. Returns how many were attached.
 */
export async function attachHeldPhotos(admin: SupabaseClient, profile: Profile, propertyId: number, io: PhotoIO = REAL_IO): Promise<number> {
  const { data } = await admin
    .from('whatsapp_logs').select('id, message, created_at')
    .eq('profile_id', profile.id).eq('direction', 'inbound')
    .gt('created_at', new Date(Date.now() - HOLD_MS).toISOString())
    .ilike('message', HELD_PATTERN)
    .order('created_at', { ascending: true })
    .limit(30)
  let attached = 0
  for (const row of (data ?? []) as Row[]) {
    const mediaId = String(row.message).match(/^📷 photo (\S+) — waiting/)?.[1]
    if (!mediaId) continue
    const saved = await storeAndAttach(admin, profile, propertyId, mediaId, io)
    await admin.from('whatsapp_logs').update({
      message: saved.ok ? `📷 photo ${mediaId} — attached to #${propertyId}` : `📷 photo ${mediaId} — couldn't be attached`,
    }).eq('id', row.id)
    if (saved.ok) attached++
  }
  return attached
}

/**
 * The listing this conversation is about, for a photo sent with no window: the
 * newest #number in the last two hours of messages that the agent may edit,
 * else the editable listing they added most recently today.
 */
async function contextListing(admin: SupabaseClient, profile: Profile): Promise<Row | null> {
  const { data: logs } = await admin
    .from('whatsapp_logs').select('message, created_at')
    .eq('profile_id', profile.id)
    .gt('created_at', new Date(Date.now() - HOLD_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(30)
  for (const l of (logs ?? []) as Row[]) {
    // A message about one listing ("Saved — listing #250 created", "update
    // #45"). A search result names several — that's no answer, keep looking.
    const ids = [...new Set([...String(l.message ?? '').matchAll(/#(\d{1,7})\b/g)].map(m => Number(m[1])))]
    if (ids.length !== 1) continue
    const listing = await editableListing(admin, profile, ids[0])
    if (typeof listing === 'object') return listing
  }
  if (!profile.agent_code) return null
  const { data: recent } = await admin
    .from('Properties').select('id, Title, Amenities, Photos, created_at')
    .eq('company_id', profile.company_id)
    .gt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .order('id', { ascending: false }).limit(20)
  return ((recent ?? []) as Row[]).find(r => agentOf(r) === profile.agent_code) ?? null
}

/**
 * A photo with nowhere to go. Say how to attach it — once: an album of ten
 * arrives as ten parallel webhooks, and ten identical replies is spam. The first
 * to claim the (unique per agent) conversation_state row answers; the rest stay
 * silent.
 */
async function strayPhoto(admin: SupabaseClient, profile: Profile, inbound: InboundMessage, io: PhotoIO): Promise<BotReply> {
  // Photos sent while the new listing is still waiting on YES: keep them, and
  // they're attached the moment it's saved (applyPendingAction).
  const { data: pending } = await admin
    .from('pending_actions').select('action_type')
    .eq('profile_id', profile.id).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const waitingOnYes = (pending as Row | null)?.action_type === 'create_property'

  // The listing the conversation is about: put them there, and say so.
  if (!waitingOnYes) {
    const listing = await contextListing(admin, profile)
    if (listing) return savePhoto(admin, profile, Number(listing.id), inbound.image!.id, io, ` ("${listing.Title}" — the listing we were just on; tell me if they're for another one)`)
  }

  await holdPhoto(admin, inbound)

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
    return 'Got the photos 📸 — reply YES to save the listing and I\'ll attach them to it.'
  }

  // Offer their latest listing as a one-tap target.
  const { data: rows } = await admin
    .from('Properties').select('id, Amenities')
    .eq('company_id', profile.company_id).order('id', { ascending: false }).limit(50)
  const latest = ((rows ?? []) as Row[]).find(r => canEditProperty(toSession(profile), agentOf(r)))
  const text = 'Got the photos 📸 Which listing are they for? Reply with its number (e.g. "#23") and I\'ll attach them — no need to send them again.'
  if (!latest) return text
  return { text, buttons: [{ id: `photos_${latest.id}`, title: `Photos for #${latest.id}` }] }
}

/** The agent's attach_photos tool: the listing named in words, held photos attached. */
export function photosFor(admin: SupabaseClient, profile: Profile, id: number, io: PhotoIO = REAL_IO): Promise<string> {
  return startWindow(admin, profile, id, io)
}

/**
 * Open the photo window for a listing the agent may edit — attaching any
 * photos they already sent that were waiting for a listing.
 */
async function startWindow(admin: SupabaseClient, profile: Profile, id: number, io: PhotoIO): Promise<string> {
  const listing = await editableListing(admin, profile, id)
  if (listing === 'missing') return `There's no listing #${id}. Check the number and try again.`
  if (listing === 'forbidden') return `#${id} belongs to another agent, so I can't add photos to it.`
  await openWindow(admin, profile, id)
  const attached = await attachHeldPhotos(admin, profile, id, io)
  if (attached) {
    return `📸 Attached the ${attached === 1 ? 'photo' : `${attached} photos`} you sent to #${id} "${listing.Title}". Send more, or reply "done".`
  }
  const have = photoCount(listing.Photos)
  return `📸 Send the photos for #${id} "${listing.Title}" now (one or several)${have ? ` — it has ${have} already` : ''}. Reply "done" when finished.`
}

export async function continuePhotoCollection(
  admin: SupabaseClient, profile: Profile, inbound: InboundMessage, origin: string, io: PhotoIO = REAL_IO,
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

  // The listing the agent opened with "find the listing of …" (listing-finder),
  // so "photos" — or just sending them — needs no #number.
  const focusId = flow === FOCUS_FLOW
    && Date.now() - new Date(String((state as Row).updated_at)).getTime() < FOCUS_MS
    ? Number(((state as Row).context as Row | null)?.propertyId) || null
    : null

  // ── A photo ────────────────────────────────────────────────────────────────
  if (inbound.image) {
    const captioned = parseCaptionTarget(inbound.image.caption, { allowBareNumber: !windowId })
    const target = captioned ?? windowId ?? focusId
    if (!target) return strayPhoto(admin, profile, inbound, io)
    // Named in the caption, or the opened listing (which may be another agent's —
    // anyone can find a listing by its title): check they may edit it.
    if (target !== windowId) {
      const listing = await editableListing(admin, profile, target)
      if (listing === 'missing') return `There's no listing #${target}. Check the number and resend the photo.`
      if (listing === 'forbidden') return `#${target} belongs to another agent, so I can't add photos to it.`
    }
    return savePhoto(admin, profile, target, inbound.image.id, io)
  }

  // ── "photos" with a listing open: open its photo window ───────────────────
  if (isPhotoRequest(text) && !open) {
    if (!focusId) {
      return 'Which listing are the photos for? Send "photos for #23", or find it first — e.g. "find the listing of Khoury".'
    }
    return startWindow(admin, profile, focusId, io)
  }

  // ── "photos for #23": open (or switch) the window ─────────────────────────
  const target = parsePhotoCommand(text)
  if (target) return startWindow(admin, profile, target, io)

  // ── Answering "which listing are these for?" with just "#250" / "250" ─────
  if (flow === HELP_FLOW) {
    const named = text.match(/^\s*#?\s*(\d{1,7})\s*$/)
    if (named) return startWindow(admin, profile, Number(named[1]), io)
    // Anything else: drop the marker and let the message route normally — the
    // agent can name the listing in words ("the Achrafieh one"), and the
    // agent's attach_photos tool attaches what's waiting.
    await clear()
    return null
  }
  if (!open || !windowId) return null

  // A yes/no while a change is waiting answers THAT — "yes" also reads as photo
  // small talk ("👍 Go ahead — send the photos"), and the change it approved
  // was never saved. The router decides it.
  if (parseBareConfirmation(text) !== 'unknown') {
    const { data: waiting } = await admin
      .from('pending_actions').select('id')
      .eq('profile_id', profile.id).gt('expires_at', new Date().toISOString())
      .limit(1).maybeSingle()
    if (waiting) return null
  }

  // Nothing to read — the empty event WhatsApp sends at the head of an album,
  // a reaction. It used to fall through to "a real request: end the window",
  // and the album's photos arrived to a closed window.
  if (!text && !inbound.image) return NO_REPLY

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
