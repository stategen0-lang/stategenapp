import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTemplate } from '@/lib/whatsapp/cloud'
import { formatZonedTime } from '@/lib/whatsapp/timezone'

// Pre-event reminders. Runs every ~15 min (Vercel Cron). Finds calendar events
// starting within the next LEAD_MINUTES that haven't been reminded yet, and
// sends the owning agent a WhatsApp nudge — then stamps reminded_at so each
// event fires once.
//
// The message is BUSINESS-INITIATED (outside WhatsApp's 24h window), so it needs
// an APPROVED template. Set env WHATSAPP_EVENT_TEMPLATE to its name; until then
// this job is a no-op (nothing is stamped, so it starts working the moment the
// template is configured). Cron auth: Authorization: Bearer $CRON_SECRET.

const LEAD_MINUTES = 40

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true            // not configured → allow (dev)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

const KIND_LABEL: Record<string, string> = {
  viewing: 'Viewing', meeting: 'Meeting', call: 'Call', follow_up: 'Follow-up', other: 'Event',
}

type Row = Record<string, unknown>

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const templateName = process.env.WHATSAPP_EVENT_TEMPLATE
  if (!templateName) {
    return Response.json({ sent: 0, note: 'WHATSAPP_EVENT_TEMPLATE not set — event reminders are off.' })
  }

  const admin = createAdminClient()
  const now = new Date()
  const windowEnd = new Date(now.getTime() + LEAD_MINUTES * 60_000)

  const { data: events } = await admin
    .from('calendar_events')
    .select('id, title, kind, starts_at, location, profile_id, client_id')
    .is('reminded_at', null)
    .eq('all_day', false)
    .gt('starts_at', now.toISOString())
    .lte('starts_at', windowEnd.toISOString())
    .order('starts_at', { ascending: true })

  const list = (events ?? []) as Row[]
  if (!list.length) return Response.json({ sent: 0, note: 'No events due a reminder.' })

  // Resolve the owning agents (whatsapp_number + enabled) and any linked clients.
  const profileIds = [...new Set(list.map(e => e.profile_id as string).filter(Boolean))]
  const clientIds = [...new Set(list.map(e => e.client_id as number).filter(Boolean))]

  const { data: profiles } = await admin
    .from('Profiles').select('id, whatsapp_number, whatsapp_enabled').in('id', profileIds)
  const profileById = new Map((profiles ?? []).map(p => [p.id as string, p as Row]))

  const clientById = new Map<number, string>()
  if (clientIds.length) {
    const { data: clients } = await admin.from('client_requests').select('id, "Client Name"').in('id', clientIds)
    for (const c of clients ?? []) clientById.set(Number((c as Row).id), (c as Row)['Client Name'] as string)
  }

  let sent = 0
  const results: { event: string; status: string }[] = []

  for (const e of list) {
    const profile = profileById.get(e.profile_id as string)
    const number = profile?.whatsapp_number as string | undefined
    if (!number || profile?.whatsapp_enabled === false) continue   // no reachable agent → leave for next tick

    const kind = KIND_LABEL[(e.kind as string) ?? 'other'] ?? 'Event'
    const client = e.client_id ? clientById.get(Number(e.client_id)) : null
    const time = formatZonedTime(new Date(e.starts_at as string))
    const mins = Math.max(1, Math.round((new Date(e.starts_at as string).getTime() - now.getTime()) / 60_000))
    const where = e.location ? ` — ${e.location}` : ''
    const what = client ? `${kind} with ${client}` : `${kind}: ${(e.title as string) || 'event'}`
    const line = `${what} at ${time}${where} (in ~${mins} min)`

    const res = await sendTemplate(number, templateName, 'en', [
      { type: 'body', parameters: [{ type: 'text', text: line }] },
    ])
    // Only stamp on a real send, so a transient failure retries next tick.
    if (res.ok) {
      await admin.from('calendar_events').update({ reminded_at: new Date().toISOString() }).eq('id', e.id as string)
      sent++
    }
    results.push({ event: e.id as string, status: res.ok ? 'sent' : 'failed' })
  }

  return Response.json({ sent, scanned: list.length, results })
}
