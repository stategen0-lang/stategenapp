// Deterministic reply parsing.
//
// The spec routes everything through Grok, but the highest-volume replies are
// a handful of fixed words ("done", "snooze 3d", "yes"). Matching those locally
// is instant, free, and can't be mangled by a model — Grok is only needed for
// genuinely open-ended messages. Pure and testable.

export type ReminderAction = 'done' | 'snooze' | 'not_interested' | 'unknown'

export interface ReminderReply {
  action: ReminderAction
  snoozeDays?: number   // only when action === 'snooze'
}

const DONE = /^(done|called|did it|spoke|spoke to (them|him|her)|contacted|finished|complete[d]?)\b/i
const NOT_INTERESTED = /\b(not interested|no longer interested|uninterested|dead|drop (it|them)|lost)\b/i
const SNOOZE = /\b(snooze|later|postpone|remind me)\b/i

// A message that opens with one of these is a fresh command, not a reply to a
// reminder — so a date word inside it ("book a viewing tomorrow") must not be
// mistaken for a snooze. Only an explicit snooze word overrides this.
const COMMAND_START = /^(add|book|schedule|create|set ?up|put in|set|mark|update|change|move|remove|delete|find|show|list|search|info|details?|who|what|which|how|where|any)\b/i

// A message naming a calendar event ("meeting tomorrow at 4pm", "viewing at 5")
// is scheduling something, not replying to a reminder — even without a leading
// command verb. Its date word must not be read as a snooze, or the message gets
// applied to whichever client has an outstanding reminder. Only an explicit
// snooze word ("snooze", "remind me") overrides this.
const EVENT_NOUN = /\b(meeting|meet|viewing|showing|visit|appointment|follow[- ]?up|call)\b/i

// "3d", "3 days", "2w", "2 weeks", "1 month"
const DURATION = /(\d+)\s*(d|day|days|w|week|weeks|m|month|months)\b/i

const NAMED_DELAYS: [RegExp, number][] = [
  [/\btomorrow\b/i, 1],
  [/\bnext week\b/i, 7],
  [/\bnext month\b/i, 30],
  [/\bin a week\b/i, 7],
]

const DEFAULT_SNOOZE_DAYS = 3

/** Days implied by a phrase, or null if none is present. */
export function parseSnoozeDays(text: string): number | null {
  if (!text) return null
  for (const [re, days] of NAMED_DELAYS) if (re.test(text)) return days

  const m = text.match(DURATION)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null

  const unit = m[2].toLowerCase()
  if (unit.startsWith('w')) return n * 7
  if (unit.startsWith('m')) return n * 30
  return n
}

/**
 * Classify a reply to a call reminder. Returns 'unknown' when it isn't one of
 * the fixed replies, so the caller can fall back to Grok rather than guessing.
 */
export function parseReminderReply(raw: string | null | undefined): ReminderReply {
  const text = (raw ?? '').trim()
  if (!text) return { action: 'unknown' }

  // A fresh command ("book a viewing tomorrow", "set X's budget…") is never a
  // reminder reply, even if it contains a date word. This stopped a real bug:
  // "book a viewing tomorrow at 3pm" was read as "snooze until tomorrow".
  const isCommand = COMMAND_START.test(text)

  // Checked before "done" so "not interested" can't be read as a completion.
  if (NOT_INTERESTED.test(text) && !isCommand) return { action: 'not_interested' }

  const days = parseSnoozeDays(text)
  // An explicit "snooze/postpone/remind me" always counts. A bare date word
  // only counts when the message is neither a command nor an event being
  // scheduled ("meeting tomorrow at 4pm" is a new event, not a snooze).
  if (SNOOZE.test(text) || (days !== null && !isCommand && !EVENT_NOUN.test(text))) {
    return { action: 'snooze', snoozeDays: days ?? DEFAULT_SNOOZE_DAYS }
  }

  if (DONE.test(text) && !isCommand) return { action: 'done' }

  return { action: 'unknown' }
}

// ── Confirmation of a pending write ─────────────────────────────────────────

export type Confirmation = 'confirm' | 'cancel' | 'unknown'

const CONFIRM = /^(yes|y|yeah|yep|ok|okay|confirm|confirmed|correct|go ahead|do it|sure)\b/i
const CANCEL = /^(no|n|nope|cancel|stop|abort|discard|nevermind|never mind)\b/i

/** Is this message approving or rejecting a pending action? */
export function parseConfirmation(raw: string | null | undefined): Confirmation {
  const text = (raw ?? '').trim()
  if (!text) return 'unknown'
  if (CANCEL.test(text)) return 'cancel'
  if (CONFIRM.test(text)) return 'confirm'
  return 'unknown'
}

// ── Scheduling helpers ──────────────────────────────────────────────────────

/** Date `days` from `from`, as an ISO date string (YYYY-MM-DD). */
export function addDays(from: Date, days: number): string {
  const d = new Date(from.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Has a pending action passed its expiry? (spec: 10 minutes) */
export function isExpired(expiresAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime()
  if (Number.isNaN(t)) return true
  return t <= now.getTime()
}
