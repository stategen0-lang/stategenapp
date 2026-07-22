// Calendar over WhatsApp: adding events and reading the day's schedule.
//
// Creating an event goes through the same confirm-before-write rule as every
// other write, because the date is inferred from prose and a misread date puts
// an agent in the wrong place at the wrong time.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWhen, describeWhen } from '@/lib/whatsapp/when'
import { startOfZonedDay, addZonedDays, formatZonedDate, formatZonedTime } from '@/lib/whatsapp/timezone'
import { stage, type Profile } from '@/lib/whatsapp/write-handlers'
import { isEventKind, kindStyle, type EventKind } from '@/lib/calendar'
import { isManager } from '@/lib/permissions'

/** Words that imply a type, so "book a viewing" doesn't land as "meeting". */
const KIND_WORDS: [RegExp, EventKind][] = [
  [/\bviewing|showing|visit\b/i, 'viewing'],
  [/\bcall|phone\b/i, 'call'],
  [/\bfollow[- ]?up\b/i, 'follow_up'],
  [/\bmeeting|meet\b/i, 'meeting'],
]

export function inferKind(text: string): EventKind {
  for (const [re, kind] of KIND_WORDS) if (re.test(text)) return kind
  return 'meeting'
}

/**
 * "2:00 PM – 3:00 PM" in the agency's zone.
 *
 * The calendar page's formatRange() renders in the *viewer's* zone, which is
 * right in a browser and wrong on a server: on Vercel it would print every time
 * in UTC, three hours off for Beirut.
 */
function zonedRange(e: { starts_at: string; ends_at: string }): string {
  const start = formatZonedTime(new Date(e.starts_at))
  const end = e.ends_at ? formatZonedTime(new Date(e.ends_at)) : ''
  return end && end !== start ? `${start} – ${end}` : start
}

/**
 * A readable title from the raw message: drop the command verb and the date
 * words, keep what the agent actually called it.
 */
export function eventTitle(text: string, matchedWhen: string): string {
  let s = String(text ?? '').trim()

  // Remove the leading command.
  s = s.replace(/^(add|book|schedule|set up|put in|create)\s+(an?\s+)?/i, '')
  // Remove the date/time words we consumed.
  for (const word of matchedWhen.split(/\s+/).filter(Boolean)) {
    s = s.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), ' ')
  }
  // Tidy the connective words left dangling by the removals.
  s = s.replace(/\b(on|at|for|this|next)\b\s*$/i, '')
       .replace(/\s+/g, ' ')
       .replace(/^[\s,–-]+|[\s,–-]+$/g, '')
       .trim()

  return s || 'Event'
}

// ── "book a viewing with Ahmed tomorrow at 3pm" ─────────────────────────────

export async function stageCreateEvent(
  admin: SupabaseClient,
  profile: Profile,
  rawMessage: string,
): Promise<string> {
  const when = parseWhen(rawMessage)
  if (!when) {
    return [
      "I couldn't work out when that is.",
      '',
      'Try "book a viewing tomorrow at 3pm" or "meeting on Friday".',
    ].join('\n')
  }

  const kind = inferKind(rawMessage)
  const title = eventTitle(rawMessage, when.matched)

  // An all-day event runs to the end of that day in the agency's zone; a timed
  // one runs an hour.
  const start = when.start
  const end = when.allDay
    ? new Date(addZonedDays(start, 1).getTime() - 1000)
    : new Date(start.getTime() + 3600_000)

  const summary = [
    'About to add to your calendar:',
    `• ${title}`,
    `• ${describeWhen(when)}`,
    `• Type: ${kindStyle(kind).label}`,
    '',
    'Reply YES to save or NO to cancel.',
  ].join('\n')

  return stage(admin, profile, 'create_event', summary, {
    table: 'calendar_events',
    columns: {
      company_id: profile.company_id,
      profile_id: profile.id,
      agent_code: profile.agent_code,
      title,
      kind: isEventKind(kind) ? kind : 'meeting',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: when.allDay,
    },
    extras: {},
    // No blobColumn: calendar_events stores no JSON blob.
    label: title,
  })
}

// ── "what's on today" ───────────────────────────────────────────────────────

interface EventRow {
  id: string
  title: string
  kind: string
  starts_at: string
  ends_at: string
  all_day: boolean
  location: string | null
  agent_code: string | null
  profile_id: string
}

/**
 * The agent's schedule for a day. Managers get the whole agency's, since that
 * is what they see on the web calendar too.
 */
export async function handleQuerySchedule(
  admin: SupabaseClient,
  profile: Profile,
  rawMessage: string,
): Promise<string> {
  const when = parseWhen(rawMessage)
  // No date mentioned ("what's on?") means today. Day boundaries come from the
  // agency's zone: on a UTC server, midnight-to-midnight UTC puts the first
  // three hours of every Beirut day on the wrong date.
  const day = when ? when.start : new Date()
  const from = startOfZonedDay(day)
  const to = addZonedDays(from, 1)

  let query = admin
    .from('calendar_events')
    .select('id, title, kind, starts_at, ends_at, all_day, location, agent_code, profile_id')
    .eq('company_id', profile.company_id)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at', { ascending: true })

  // An agent sees only their own; a manager sees everyone's.
  if (!isManager(profile.role)) query = query.eq('profile_id', profile.id)

  const { data } = await query
  const events = (data ?? []) as EventRow[]

  const label = formatZonedDate(from)
  if (!events.length) return `Nothing scheduled for ${label}.`

  // Managers need to know whose event it is; agents already know.
  let nameOf = new Map<string, string>()
  if (isManager(profile.role)) {
    const { data: people } = await admin
      .from('Profiles').select('id, Full_name').eq('company_id', profile.company_id)
    nameOf = new Map((people ?? []).map(p => [p.id as string, p.Full_name as string]))
  }

  const lines = events.map(e => {
    const time = e.all_day ? 'All day' : zonedRange(e)
    const who = isManager(profile.role) ? ` — ${nameOf.get(e.profile_id) ?? 'unassigned'}` : ''
    const where = e.location ? ` (${e.location})` : ''
    return `• ${time} — ${e.title}${where}${who}`
  })

  return [`${label}: ${events.length} event${events.length > 1 ? 's' : ''}`, ...lines].join('\n')
}

// ── The daily reminder's agenda section ─────────────────────────────────────

/**
 * Today's events for one agent, formatted for the morning reminder. Returns an
 * empty string when there is nothing, so the caller can leave the section out.
 */
export async function todaysAgenda(
  admin: SupabaseClient,
  profileId: string,
  now: Date = new Date(),
): Promise<string> {
  const from = startOfZonedDay(now)
  const to = addZonedDays(from, 1)

  const { data } = await admin
    .from('calendar_events')
    .select('title, kind, starts_at, ends_at, all_day, location')
    .eq('profile_id', profileId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at', { ascending: true })

  const events = (data ?? []) as EventRow[]
  if (!events.length) return ''

  const lines = events.map(e => {
    const time = e.all_day ? 'All day' : zonedRange(e)
    const where = e.location ? ` (${e.location})` : ''
    return `• ${time} — ${e.title}${where}`
  })

  return [`Today: ${events.length} event${events.length > 1 ? 's' : ''}`, ...lines].join('\n')
}
