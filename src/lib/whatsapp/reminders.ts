// Phase 4 — follow-up reminders.
//
// The spec runs this on Supabase pg_cron; this app runs on Vercel, so the
// schedule lives in vercel.json and calls /api/whatsapp/send-reminder. The
// decision logic is kept here, pure, so "who gets pinged and what does it say"
// is testable without a database, a scheduler or Twilio.

import type { ReminderAction } from '@/lib/whatsapp/replies'

/** A client, reduced to what a reminder decision needs. */
export interface ReminderClient {
  id: number
  name: string
  status: string
  budget: number
  propertyType: string
  location: string
  /** ISO timestamp of the most recent contact, or null if never. */
  lastContactAt: string | null
  createdAt: string
  /** 0–100 lead score (fit + behaviour + engagement), when available. */
  leadScore?: number
}

/** Default follow-up cadence (days) — used for Searching and unknown stages. */
export const STALE_AFTER_DAYS = 5

/** Statuses that mean the client is no longer worth chasing. */
const CLOSED_STATUSES = ['Closed', 'Inactive']

// Stage-aware cadence: a hot lead (negotiating, viewings booked) should be
// chased within a couple of days; a browsing "Searching" client can wait longer.
// This is what makes a reminder *relevant* instead of "oldest untouched record".
const CADENCE: Record<string, number> = {
  Negotiation: 2,
  Viewing: 3,
  Signed: 3,
}
export function cadenceFor(status: string): number {
  return CADENCE[status] ?? STALE_AFTER_DAYS
}

// How much each stage lifts a client up the "call this one first" ranking.
const STAGE_BOOST: Record<string, number> = {
  Negotiation: 40,
  Viewing: 30,
  Signed: 20,
  Searching: 10,
}

/**
 * Priority for picking THE client to nudge today — higher = call first. Driven
 * by the lead score (already blends fit/behaviour/engagement), lifted by an
 * active stage, with a small, capped bump for being overdue. The cap stops a
 * cold client who's been stale for months from outranking a hot, freshly-due
 * lead — which was the whole complaint about the old "just pick the oldest".
 */
export function reminderPriority(client: ReminderClient, now: Date = new Date()): number {
  const days = daysSince(client.lastContactAt ?? client.createdAt, now)
  const overdue = Number.isFinite(days) ? Math.max(0, days - cadenceFor(client.status)) : 14
  const stage = STAGE_BOOST[client.status] ?? 0
  const score = client.leadScore ?? 0
  return score + stage + Math.min(overdue, 14) * 0.5
}

export function daysSince(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return Infinity
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return Infinity
  return Math.floor((now.getTime() - then) / 86_400_000)
}

/**
 * Most recent contact: the newest entry in the client's activity log, falling
 * back to when the record was created. A client logged five minutes ago should
 * never be flagged stale just because nobody filled in a contact date.
 */
export function lastContactAt(notesJson: unknown, createdAt: string): string | null {
  try {
    const parsed = JSON.parse(String(notesJson || '{}'))
    const log = parsed?.log
    if (Array.isArray(log) && log.length) {
      // appendLog writes newest-first, but don't rely on that — take the max.
      const newest = log
        .map((e: { at?: string }) => e?.at)
        .filter((s): s is string => typeof s === 'string')
        .sort()
        .pop()
      if (newest) return newest
    }
  } catch { /* corrupt blob: fall through to created_at */ }
  return createdAt ?? null
}

/** Should this client be chased today? Uses the stage-aware cadence unless an
 *  explicit staleDays is given. */
export function isDue(client: ReminderClient, now: Date = new Date(), staleDays?: number): boolean {
  if (CLOSED_STATUSES.includes(client.status)) return false
  const cadence = staleDays ?? cadenceFor(client.status)
  return daysSince(client.lastContactAt ?? client.createdAt, now) >= cadence
}

/**
 * The reminder text, following the spec's wording. The reply options are spelled
 * out because an agent shouldn't have to remember the syntax.
 */
export function reminderText(client: ReminderClient, now: Date = new Date()): string {
  const days = daysSince(client.lastContactAt ?? client.createdAt, now)
  const last = Number.isFinite(days)
    ? `Last contact: ${days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`}.`
    : 'No contact logged yet.'

  const interest = [
    client.propertyType || null,
    client.budget ? `$${client.budget.toLocaleString('en-US')}` : null,
    client.location || null,
  ].filter(Boolean).join(' · ')

  // Lead score tells the agent why this one is worth the call (and flags hot leads).
  const scoreLine = client.leadScore
    ? `Lead score: ${client.leadScore}/100${client.leadScore >= 70 ? ' — hot 🔥' : ''}.`
    : null

  return [
    `Reminder: Call ${client.name} today.`,
    last,
    scoreLine,
    interest ? `Interest: ${interest}.` : null,
    '',
    'Reply: done, snooze 3d, or not interested',
  ].filter(v => v !== null).join('\n')
}

/**
 * A single-line summary of the top follow-ups for the daily digest. The first is
 * the primary (the one a "done"/"snooze" reply acts on); the rest are a heads-up
 * so the agent sees their whole hot list, not just one name.
 */
export function followupSummary(clients: ReminderClient[], now: Date = new Date()): string {
  if (!clients.length) return 'No follow-ups due today.'
  const label = (c: ReminderClient) => {
    const d = daysSince(c.lastContactAt ?? c.createdAt, now)
    const meta = [
      c.leadScore ? `score ${c.leadScore}` : null,
      Number.isFinite(d) ? `${d}d` : null,
    ].filter(Boolean).join(', ')
    return `${c.name}${meta ? ` (${meta})` : ''}`
  }
  const [first, ...rest] = clients.slice(0, 3)
  let out = `Call ${label(first)} first`
  if (rest.length) out += ` — also today: ${rest.map(label).join(', ')}`
  return out + '.'
}

// ── What a reply does ───────────────────────────────────────────────────────

export interface ReminderOutcome {
  /** New reminder_schedule.status */
  status: 'done' | 'snoozed' | 'not_interested'
  /** New due_date, when snoozed. */
  dueDate?: string
  /** Client status to write, when the reply implies one. */
  clientStatus?: string
  /** Line to append to the client's activity log. */
  logEntry: string
  /** What to say back. */
  reply: string
}

/**
 * The substance of a reminder reply beyond its keyword. "done" yields nothing;
 * "called Ahmed, wants a viewing Saturday" yields the useful remainder.
 */
export function extraDetail(raw: string | null | undefined): string {
  const text = (raw ?? '').trim()
  if (!text) return ''
  const stripped = text
    // Leading action word and any client name that follows it.
    .replace(/^(done|called|did it|spoke( to)?|contacted|finished|complete[d]?|snoozed?|not interested)\b/i, '')
    .replace(/^\s*(to|with)\b/i, '')
    .replace(/^[\s,:;-]+/, '')
    .trim()
  // A bare keyword leaves nothing; a couple of stray characters aren't a note.
  return stripped.length > 3 ? stripped.slice(0, 300) : ''
}

/** Date `days` from `from` as YYYY-MM-DD. */
function addDays(from: Date, days: number): string {
  const d = new Date(from.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Translate a reminder reply into the record changes it implies.
 *
 * Reminder replies are deliberately applied without a confirmation step: they
 * are a fixed three-way choice, not a free-text parse, so there is no misparse
 * to guard against — and making an agent confirm "done" twice a day would get
 * the whole feature switched off.
 */
export function reminderOutcome(
  action: ReminderAction,
  clientName: string,
  snoozeDays = 3,
  now: Date = new Date(),
  /** The agent's full message, so detail beyond the keyword isn't discarded. */
  rawMessage = '',
): ReminderOutcome | null {
  // "called Ahmed, wants a viewing Saturday" is both a reminder reply and a
  // piece of feedback. Recording only "Called" threw away the part the agent
  // actually bothered to type.
  const detail = extraDetail(rawMessage)

  switch (action) {
    case 'done':
      return {
        status: 'done',
        logEntry: detail ? `Called — ${detail}` : 'Called (via WhatsApp reminder)',
        reply: detail
          ? `Noted — ${clientName} marked as contacted, and I saved your note.`
          : `Noted — ${clientName} marked as contacted.`,
      }
    case 'snooze': {
      const dueDate = addDays(now, snoozeDays)
      return {
        status: 'snoozed',
        dueDate,
        logEntry: `Snoozed follow-up ${snoozeDays}d (via WhatsApp reminder)`,
        reply: `OK — I'll remind you about ${clientName} on ${dueDate}.`,
      }
    }
    case 'not_interested':
      return {
        status: 'not_interested',
        clientStatus: 'Inactive',
        logEntry: 'Not interested (via WhatsApp reminder)',
        reply: `Noted — ${clientName} marked inactive and removed from follow-ups.`,
      }
    default:
      return null
  }
}
