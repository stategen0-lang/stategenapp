// Sending a listing to the company's marketing team — shared by the web button
// (/api/properties/marketing) and the WhatsApp bot, so both check the same
// permissions and send the exact same email.
//
// Only the listing's own agent or a manager may send it. The email is built from
// publicListing() — the same allowlist as the public share page — so the owner's
// details, internal notes and private documents never leave the company.
//
// Server-only (admin client, env secrets).

import type { SupabaseClient } from '@supabase/supabase-js'
import { canEditProperty, type Session } from '@/lib/permissions'
import { dbRowToProperty } from '@/lib/db-mappers'
import { makeShareToken, shareSecret, publicListing } from '@/lib/share'
import { parseRecipients, renderMarketingEmail } from '@/lib/marketing-email'
import { mergeExtras } from '@/lib/whatsapp/writes'
import { sendMail, mailConfigured } from '@/lib/mailer'
import { isStoredPhoto } from '@/lib/upload'

// A double-click, or the web and WhatsApp in quick succession, shouldn't email twice.
const DOUBLE_SEND_GUARD_MS = 60_000

// Gmail rejects a message over 25 MB, and attachments grow by a third when
// encoded, so ~15 MB of photos is the safe ceiling. Photos past it are still in
// the email, shown from their link instead of attached.
const ATTACH_BUDGET_BYTES = 15 * 1024 * 1024
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

/** The part of a session this needs — the web session or a WhatsApp profile. */
export type MarketingActor = Pick<Session, 'userId' | 'companyId' | 'role' | 'agentCode' | 'fullName'>

export type SendOutcome =
  | { ok: true; sentAt: string; to: string[]; title: string }
  | { ok: false; status: number; error: string }

/**
 * Download a listing's photos to attach them. Only from our own Supabase storage:
 * Photos can hold any URL the edit form sent, and the server must not be made to
 * fetch arbitrary addresses. Attached as plain files (no cid) — Gmail only offers
 * hover-download and "Download all" for attachments that aren't embedded.
 */
async function attachPhotos(photos: string[], listingId: number) {
  const attachments: { filename: string; content: Buffer; contentType: string }[] = []
  const attachedFiles: Record<number, string> = {}
  let storageOrigin = ''
  try { storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin } catch { return { attachments, attachedFiles } }

  const fetched = await Promise.all(photos.map(async (src, i) => {
    try {
      const u = new URL(src)
      if (u.origin !== storageOrigin || !isStoredPhoto(src)) return null
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return null
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      if (!EXT[contentType]) return null
      return { i, contentType, content: Buffer.from(await res.arrayBuffer()) }
    } catch { return null }
  }))

  let used = 0
  for (const f of fetched) {
    if (!f || used + f.content.length > ATTACH_BUDGET_BYTES) continue
    used += f.content.length
    const filename = `listing-${listingId}-photo-${f.i + 1}.${EXT[f.contentType]}`
    attachments.push({ filename, content: f.content, contentType: f.contentType })
    attachedFiles[f.i] = filename
  }
  return { attachments, attachedFiles }
}

/** The company's marketing recipients, or null when the feature isn't set up. */
export async function marketingRecipients(admin: SupabaseClient, companyId: number): Promise<string[] | null> {
  // select('*') so a missing migration 023 reads as "not set up" rather than erroring.
  const { data } = await admin.from('Companies').select('*').eq('id', companyId).maybeSingle()
  const parsed = parseRecipients((data as Record<string, unknown> | null)?.marketing_email)
  return parsed.ok && parsed.emails.length ? parsed.emails : null
}

/**
 * Could this actor send this listing right now? Checked before the bot offers it,
 * so an agent is never asked "send to marketing?" for something that would fail.
 */
export async function marketingEligibility(
  admin: SupabaseClient, actor: MarketingActor, propertyId: number,
): Promise<{ ok: true; title: string; to: string[] } | { ok: false; status: number; error: string }> {
  const { data: row } = await admin
    .from('Properties').select('*').eq('id', propertyId).eq('company_id', actor.companyId).maybeSingle()
  if (!row) return { ok: false, status: 404, error: `There's no listing #${propertyId}.` }
  const p = dbRowToProperty(row as Record<string, unknown>, 0)
  if (!canEditProperty(actor as Session, p.agentId)) {
    return { ok: false, status: 403, error: 'Only the listing\'s agent or a manager can send it to marketing.' }
  }
  const to = await marketingRecipients(admin, actor.companyId)
  if (!to) return { ok: false, status: 409, error: 'No marketing email is set up. A manager can add one in Settings.' }
  if (!mailConfigured()) return { ok: false, status: 503, error: 'Email sending is not configured on the server.' }
  return { ok: true, title: p.title, to }
}

export async function sendListingToMarketing(
  admin: SupabaseClient, actor: MarketingActor, propertyId: number, origin: string,
): Promise<SendOutcome> {
  const eligible = await marketingEligibility(admin, actor, propertyId)
  if (!eligible.ok) return eligible

  const [{ data: row }, { data: company }] = await Promise.all([
    admin.from('Properties').select('*').eq('id', propertyId).eq('company_id', actor.companyId).maybeSingle(),
    admin.from('Companies').select('*').eq('id', actor.companyId).maybeSingle(),
  ])
  if (!row) return { ok: false, status: 404, error: `There's no listing #${propertyId}.` }
  const r = row as Record<string, unknown>
  const p = dbRowToProperty(r, 0)
  const c = (company ?? {}) as Record<string, unknown>

  let extras: Record<string, unknown> = {}
  try { extras = JSON.parse((r.Amenities as string) || '{}') } catch { extras = {} }
  const last = Date.parse(String(extras.marketingSentAt ?? ''))
  if (Number.isFinite(last) && Date.now() - last < DOUBLE_SEND_GUARD_MS) {
    return { ok: false, status: 429, error: 'This listing was just sent. Wait a minute before sending it again.' }
  }

  // The listing agent's name and number go on the post as the enquiry contact.
  const { data: agent } = await admin
    .from('Profiles').select('Full_name, whatsapp_number')
    .eq('company_id', actor.companyId).eq('agent_code', p.agentId).maybeSingle()
  const a = (agent ?? {}) as Record<string, unknown>

  const listing = publicListing(p, p.aiDescription?.trim() ?? '')
  const { attachments, attachedFiles } = await attachPhotos(listing.photos, propertyId)
  const companyName = (c.Name as string) || ''

  const email = renderMarketingEmail({
    listing,
    attachedFiles,
    listingId: propertyId,
    shareUrl: `${origin}/l/${makeShareToken(propertyId, shareSecret())}`,
    agentName: (a.Full_name as string) || actor.fullName,
    agentPhone: (a.whatsapp_number as string) || null,
    companyName: companyName || null,
    brandColor: (c.brand_color as string) || null,
  })

  // Every agency sends through the one StateGen mailbox, so without this a
  // marketing team's reply would land in StateGen's inbox, not the agency's.
  const { data: owner } = await admin
    .from('Profiles').select('id').eq('company_id', actor.companyId).eq('role', 'owner').maybeSingle()
  const ownerEmail = owner
    ? (await admin.auth.admin.getUserById((owner as { id: string }).id)).data?.user?.email ?? undefined
    : undefined

  const sent = await sendMail({
    to: eligible.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    fromName: companyName ? `${companyName} via StateGen` : 'StateGen',
    replyTo: ownerEmail,
    attachments,
  })
  if (!sent.ok) {
    console.error('[marketing] send failed', sent.error)
    return { ok: false, status: 502, error: `The email couldn't be sent: ${sent.error}` }
  }

  // Record the send on the listing (merged, so nothing else in the blob changes).
  const sentAt = new Date().toISOString()
  await admin.from('Properties')
    .update({ Amenities: mergeExtras(r.Amenities, { marketingSentAt: sentAt, marketingSentBy: actor.fullName }) })
    .eq('id', propertyId).eq('company_id', actor.companyId)

  return { ok: true, sentAt, to: eligible.to, title: p.title }
}
