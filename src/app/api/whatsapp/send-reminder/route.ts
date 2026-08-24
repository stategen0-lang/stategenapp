import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTemplate } from '@/lib/whatsapp/cloud'
import { dbRowToClient } from '@/lib/db-mappers'
import {
  isDue, lastContactAt, reminderText, reminderPriority, STALE_AFTER_DAYS,
  type ReminderClient,
} from '@/lib/whatsapp/reminders'
import { todaysAgenda } from '@/lib/whatsapp/calendar-handlers'
import { wallClock } from '@/lib/whatsapp/timezone'

// Runs from Vercel Cron (see vercel.json), now **hourly**. Each agent picks the
// local hour they want their digest (Profiles.reminder_hour, Asia/Beirut); this
// job fires every hour and messages only the agents whose chosen hour equals the
// current local hour. Cron is UTC, but we compare against the agency's wall clock
// via wallClock(), so DST is handled automatically — no October edit needed.
//
// The daily digest goes out as an APPROVED TEMPLATE (sendTemplate), because it is
// sent outside WhatsApp's 24-hour service window — free text there is silently
// dropped by Meta. Template name defaults to 'daily_agenda' (override with
// WHATSAPP_REMINDER_TEMPLATE). Its body has three {{n}} params, all single-line:
//   {{1}} agent first name   {{2}} today's agenda   {{3}} the follow-up nudge
const TEMPLATE_NAME = process.env.WHATSAPP_REMINDER_TEMPLATE || 'daily_agenda'
const TEMPLATE_LANG = process.env.WHATSAPP_REMINDER_TEMPLATE_LANG || 'en'

// Template variables can't contain newlines, tabs, or >4 spaces (Meta rejects
// them), so every param is squashed to a single clean line.
function oneLine(s: string, max = 500): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return (t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t) || '—'
}

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

  // ── Agents due a digest ────────────────────────────────────────────────────
  // Per-agent reminder times need an HOURLY cron so each hour we can message the
  // agents who picked that hour. But hourly cron is a **Vercel Pro** feature —
  // Hobby only allows once-per-day and rejects a more frequent schedule at
  // deploy time. So this is opt-in via WHATSAPP_REMINDER_HOURLY:
  //   • Pro:   set the cron to "0 * * * *" AND WHATSAPP_REMINDER_HOURLY=true →
  //            each hour, message agents whose reminder_hour == the local hour.
  //   • Hobby: leave it unset. The daily cron fires once and everyone due gets
  //            their digest (reminder_hour is ignored). Agents can still set a
  //            preferred hour in Settings; it takes effect once you're on Pro.
  const hourly = process.env.WHATSAPP_REMINDER_HOURLY === 'true'
  const nowHour = wallClock(now).hour
  const COLS = 'id, company_id, role, agent_code, Full_name, whatsapp_number'
  type ProfileRow = { id: string; company_id: number; role: string; agent_code: string | null; Full_name: string | null; whatsapp_number: string | null }
  let profiles: ProfileRow[] | null

  if (hourly) {
    const res = await admin.from('Profiles').select(COLS).not('whatsapp_number', 'is', null).eq('reminder_hour', nowHour)
    // Migration 015 not applied yet → no reminder_hour column; send to all.
    profiles = res.error?.code === '42703'
      ? (await admin.from('Profiles').select(COLS).not('whatsapp_number', 'is', null)).data
      : res.data
  } else {
    profiles = (await admin.from('Profiles').select(COLS).not('whatsapp_number', 'is', null)).data
  }

  if (!profiles?.length) return Response.json({ sent: 0, cleanup, hour: nowHour, hourly, note: 'No agents due a digest.' })

  const results: { agent: string; client: string; events: number; status: string }[] = []

  for (const profile of profiles) {
    if (!profile.whatsapp_number) continue   // selected as non-null, but narrow the type

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
        leadScore: Number(row.lead_score) || 0,
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
    // bot muted. Pick the most RELEVANT one (hottest lead / most urgent stage),
    // not merely the oldest untouched record.
    const top = candidates
      .sort((a, b) => reminderPriority(b.client, now) - reminderPriority(a.client, now))[0]

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

    // Fill the three single-line template params. Because we skip when there's
    // neither an agenda nor a follow-up, at least one is real; the other shows a
    // friendly "nothing" line so no param is ever empty (Meta rejects empties).
    const firstName = (profile.Full_name ?? '').trim().split(/\s+/)[0] || 'there'
    const agendaParam = agenda ? oneLine(agenda.replace(/\n/g, ' · ').replace(/•\s*/g, '')) : 'Nothing scheduled today.'
    const followParam = top
      ? oneLine(reminderText(top.client, now).split('\n').slice(0, 3).join(' '))
      : 'No follow-ups due today.'
    const components = [{
      type: 'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: agendaParam },
        { type: 'text', text: followParam },
      ],
    }]

    // Sent as an approved template — this fires outside the 24h window, where
    // free text is silently dropped by Meta.
    const sent = await sendTemplate(profile.whatsapp_number, TEMPLATE_NAME, TEMPLATE_LANG, components)
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
