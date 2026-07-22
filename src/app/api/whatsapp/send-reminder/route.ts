import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWhatsApp } from '@/lib/whatsapp/twilio'
import { dbRowToClient } from '@/lib/db-mappers'
import {
  isDue, lastContactAt, reminderText, STALE_AFTER_DAYS,
  type ReminderClient,
} from '@/lib/whatsapp/reminders'
import { todaysAgenda } from '@/lib/whatsapp/calendar-handlers'

// Runs from Vercel Cron (see vercel.json). The spec uses Supabase pg_cron; this
// app is deployed on Vercel, so the schedule lives there and calls this route.
//
// Scheduled at 06:00 UTC. Vercel Cron only understands UTC, so that is 9am in
// Beirut during summer time (UTC+3) and 8am in winter (UTC+2). If the winter
// hour matters, the cron expression needs changing in October — there is no way
// to express "9am local" in vercel.json.

/**
 * Only the scheduler may run this. Without the check, anyone who found the URL
 * could trigger an unlimited WhatsApp send at the account's expense — and
 * repeatedly spam every agent. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function clientAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // ?dry=1 reports who would be messaged WITHOUT SENDING ANYTHING. It suppresses
  // outbound messages only — housekeeping below still runs, because that is
  // idempotent and there is no reason to withhold it. Keeping cleanup behind
  // !dry meant the only way to test it was a live run, which sent real messages
  // and burned the Twilio account's daily quota.
  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  const admin = createAdminClient()

  // ── Housekeeping (spec Phase 5) ───────────────────────────────────────────
  // Expired confirmations are already ignored at read time, but they accumulate
  // forever otherwise. Abandoned half-finished flows are cleared after a day so
  // they can't resume under an unrelated message weeks later.
  const cleanup = { pendingActions: 0, staleFlows: 0 }
  const { data: expired } = await admin
    .from('pending_actions').delete().lt('expires_at', now.toISOString()).select('id')
  cleanup.pendingActions = expired?.length ?? 0

  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const { data: stale } = await admin
    .from('conversation_state').delete().lt('updated_at', dayAgo).select('id')
  cleanup.staleFlows = stale?.length ?? 0

  // ── Agents who can actually receive a message ─────────────────────────────
  const { data: profiles } = await admin
    .from('Profiles')
    .select('id, company_id, role, agent_code, Full_name, whatsapp_number')
    .not('whatsapp_number', 'is', null)

  if (!profiles?.length) return Response.json({ sent: 0, cleanup, note: 'No agents have a WhatsApp number registered.' })

  const results: { agent: string; client: string; events: number; status: string }[] = []

  for (const profile of profiles) {
    // ── Reminders already scheduled and due ─────────────────────────────────
    const { data: due } = await admin
      .from('reminder_schedule')
      .select('id, client_id')
      .eq('profile_id', profile.id)
      .eq('status', 'pending')
      .lte('due_date', today)

    const scheduledClientIds = new Set((due ?? []).map(r => Number(r.client_id)))

    // ── Plus clients that have gone quiet ───────────────────────────────────
    const { data: rows } = await admin
      .from('client_requests')
      .select('*')
      .eq('company_id', profile.company_id)

    const mine = (rows ?? []).filter(r =>
      // Managers have no agent_code and own no clients; they aren't chased.
      profile.agent_code ? clientAgent(r) === profile.agent_code : false)

    const candidates: { row: Record<string, unknown>; client: ReminderClient; reminderId?: string }[] = []

    for (const row of mine) {
      const c = dbRowToClient(row, 0)
      const rc: ReminderClient = {
        id: c.id,
        name: c.name,
        status: c.status,
        budget: c.budget,
        propertyType: c.req.type || '',
        location: c.req.location || '',
        lastContactAt: lastContactAt(row.notes, row.created_at as string),
        createdAt: row.created_at as string,
      }
      const scheduled = scheduledClientIds.has(c.id)
      if (scheduled || isDue(rc, now)) {
        candidates.push({
          row,
          client: rc,
          reminderId: (due ?? []).find(r => Number(r.client_id) === c.id)?.id as string | undefined,
        })
      }
    }

    // ── Today's calendar ────────────────────────────────────────────────────
    // Folded into the same message rather than sent separately: one message per
    // agent per day is the rule, and the Twilio account is metered.
    const agenda = await todaysAgenda(admin, profile.id, now)

    // At most one client nudge — a morning of eight separate pings gets the
    // bot muted.
    const top = candidates
      .sort((a, b) => (a.client.lastContactAt ?? '').localeCompare(b.client.lastContactAt ?? ''))[0]

    const sections = [agenda, top ? reminderText(top.client, now) : ''].filter(Boolean)
    // An agent with an empty calendar and nobody to chase hears nothing.
    if (!sections.length) continue

    const message = sections.join('\n\n')
    results.push({
      agent: profile.Full_name ?? profile.id,
      client: top?.client.name ?? '—',
      events: agenda ? agenda.split('\n').length - 1 : 0,
      status: dry ? 'dry-run' : 'sending',
    })
    if (dry) continue

    const sent = await sendWhatsApp(`whatsapp:${profile.whatsapp_number}`, message)
    if (!sent.ok) {
      console.error('[whatsapp] reminder send failed', sent.error)
      results[results.length - 1].status = `failed: ${sent.error}`
      continue
    }
    results[results.length - 1].status = 'sent'

    // Record which client the nudge was about, so a reply ("done") has
    // something to attach to. Only when there was one.
    if (top) {
      if (top.reminderId) {
        await admin.from('reminder_schedule')
          .update({ status: 'sent', sent_at: now.toISOString() })
          .eq('id', top.reminderId)
      } else {
        await admin.from('reminder_schedule').insert({
          company_id: profile.company_id,
          profile_id: profile.id,
          client_id: top.client.id,
          due_date: today,
          status: 'sent',
          sent_at: now.toISOString(),
        })
      }
    }

    await admin.from('whatsapp_logs').insert({
      company_id: profile.company_id,
      profile_id: profile.id,
      from_number: profile.whatsapp_number,
      direction: 'outbound',
      message,
      intent: 'reminder',
    })
  }

  return Response.json({ dry, staleAfterDays: STALE_AFTER_DAYS, cleanup, count: results.length, results })
}

// Vercel Cron issues GET; accept both so the schedule and manual runs agree.
export async function GET(req: NextRequest) {
  return POST(req)
}
