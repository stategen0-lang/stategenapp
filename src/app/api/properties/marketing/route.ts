import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { canEditProperty } from '@/lib/permissions'
import { dbRowToProperty } from '@/lib/db-mappers'
import { makeShareToken, shareSecret, publicListing } from '@/lib/share'
import { parseRecipients, renderMarketingEmail } from '@/lib/marketing-email'
import { mergeExtras } from '@/lib/whatsapp/writes'
import { sendMail, mailConfigured } from '@/lib/mailer'

// "Send to marketing": email a listing to the company's marketing team so they
// can post it on OLX / Instagram / Facebook.
//
// Only the listing's own agent or a manager may send it. The email is built from
// publicListing() — the same allowlist as the public share page — so the owner's
// details, internal notes and private documents never leave the company.

// A double-click or a popup + button in quick succession shouldn't email twice.
const DOUBLE_SEND_GUARD_MS = 60_000

function origin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}`
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { id?: unknown }
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid listing id is required.' }, { status: 400 })

  const admin = createAdminClient()
  const [{ data: row }, { data: company }] = await Promise.all([
    admin.from('Properties').select('*').eq('id', id).eq('company_id', session.companyId).maybeSingle(),
    admin.from('Companies').select('*').eq('id', session.companyId).maybeSingle(),
  ])
  if (!row) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 })

  const r = row as Record<string, unknown>
  const p = dbRowToProperty(r, 0)
  if (!canEditProperty(session, p.agentId)) {
    return NextResponse.json({ error: 'Only the listing\'s agent or a manager can send it to marketing.' }, { status: 403 })
  }

  const c = (company ?? {}) as Record<string, unknown>
  const recipients = parseRecipients(c.marketing_email)
  if (!recipients.ok || !recipients.emails.length) {
    return NextResponse.json({ error: 'No marketing email is set up. A manager can add one in Settings.' }, { status: 409 })
  }

  let extras: Record<string, unknown> = {}
  try { extras = JSON.parse((r.Amenities as string) || '{}') } catch { extras = {} }
  const last = Date.parse(String(extras.marketingSentAt ?? ''))
  if (Number.isFinite(last) && Date.now() - last < DOUBLE_SEND_GUARD_MS) {
    return NextResponse.json({ error: 'This listing was just sent. Wait a minute before sending it again.' }, { status: 429 })
  }

  if (!mailConfigured()) {
    return NextResponse.json({ error: 'Email sending is not configured on the server.' }, { status: 503 })
  }

  // The listing agent's name and number go on the post as the enquiry contact.
  const { data: agent } = await admin
    .from('Profiles').select('Full_name, whatsapp_number')
    .eq('company_id', session.companyId).eq('agent_code', p.agentId).maybeSingle()
  const a = (agent ?? {}) as Record<string, unknown>

  const email = renderMarketingEmail({
    listing: publicListing(p, p.aiDescription?.trim() ?? ''),
    listingId: id,
    shareUrl: `${origin(req)}/l/${makeShareToken(id, shareSecret())}`,
    agentName: (a.Full_name as string) || session.fullName,
    agentPhone: (a.whatsapp_number as string) || null,
    companyName: (c.Name as string) || null,
    brandColor: (c.brand_color as string) || null,
  })

  // Every agency sends through the one StateGen mailbox, so without this a
  // marketing team's reply would land in StateGen's inbox, not the agency's.
  // Route replies to the company owner's real login email.
  const { data: owner } = await admin
    .from('Profiles').select('id').eq('company_id', session.companyId).eq('role', 'owner').maybeSingle()
  const ownerEmail = owner
    ? (await admin.auth.admin.getUserById((owner as { id: string }).id)).data?.user?.email ?? undefined
    : undefined

  const companyName = (c.Name as string) || ''
  const sent = await sendMail({
    to: recipients.emails,
    subject: email.subject,
    html: email.html,
    text: email.text,
    fromName: companyName ? `${companyName} via StateGen` : 'StateGen',
    replyTo: ownerEmail,
  })
  if (!sent.ok) {
    console.error('[marketing] send failed', sent.error)
    return NextResponse.json({ error: `The email couldn't be sent: ${sent.error}` }, { status: 502 })
  }

  // Record the send on the listing (merged, so nothing else in the blob changes).
  const sentAt = new Date().toISOString()
  await admin.from('Properties')
    .update({ Amenities: mergeExtras(r.Amenities, { marketingSentAt: sentAt, marketingSentBy: session.fullName }) })
    .eq('id', id).eq('company_id', session.companyId)

  return NextResponse.json({ ok: true, sentAt, to: recipients.emails })
}
