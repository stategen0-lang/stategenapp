// Deterministic reply parsing.
//
// The spec routes everything through a model, but the highest-volume replies are
// a handful of fixed words ("done", "snooze 3d", "yes"). Matching those locally
// is instant, free, and can't be mangled by a model — the model is only needed for
// genuinely open-ended messages. Pure and testable.

export type ReminderAction = 'done' | 'snooze' | 'not_interested' | 'unknown'

export interface ReminderReply {
  action: ReminderAction
  snoozeDays?: number   // only when action === 'snooze'
}

// A bare completion of the CURRENT reminder ("done", "did it", "finished") or a
// verb with only a pronoun after it ("called him", "spoke to them", "contacted").
// A completion verb followed by a NAME ("spoke to Ahmed", "called Sara") is
// FEEDBACK about that specific client, not a reply to the current reminder, so it
// deliberately does NOT match here (it falls through to intent classification).
const DONE_BARE = /^(done|did it|finished|complete[d]?)\b/i
// A completion verb followed by a PRONOUN ("called them, all good") or nothing
// ("called", "contacted") — a reply about the current reminder. A verb followed
// by a NAME ("called Sara", "spoke to Ahmed") is feedback and must NOT match.
const DONE_PRONOUN = /^(called|spoke(?:\s+to)?|contacted|reached(?:\s+out)?)(\s+(them|him|her|it)\b|\s*[.!]*$)/i
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

// "3d", "3 days", "2w", "2 weeks", "1 mo", "1 month". Not "m": "8.5m" is a
// price and "3m" is Arabizi (3 = ع, "3m dawwar" = I'm looking) — both were
// read as months. Nor a number glued to letters or a decimal point before it.
const DURATION = /(?<![\w.])(\d+)\s*(d|days?|w|wks?|weeks?|mos?|months?)\b/i

// A reply to a reminder is short ("done", "snooze 3 days", "called him, not
// interested"). Longer messages are about something else, and reading one as a
// reply moved whichever client's reminder happened to be outstanding.
const MAX_REPLY_WORDS = 12

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
 * the fixed replies, so the caller can fall back to the model rather than guessing.
 */
export function parseReminderReply(raw: string | null | undefined): ReminderReply {
  const text = (raw ?? '').trim()
  if (!text) return { action: 'unknown' }

  // "remind me … TO <task>" is a NEW reminder to schedule, never a snooze of
  // the current follow-up — even though it contains "remind me". Hand it to
  // intent classification (→ create_event).
  //
  // The time phrase can sit anywhere: "remind me to call Jess in 42 minutes",
  // but also "remind me tomorrow to call Abalen" and "remind me in 2 days to
  // call Joe". Matching only "remind me to" read those last two as a snooze and
  // silently moved a DIFFERENT client's follow-up — the one whose reminder was
  // outstanding. "remind me later" and "remind me next week" name no task, so
  // they stay snoozes.
  if (/\bremind\s+me\b[^.!?]*?\bto\s+\w/i.test(text)) return { action: 'unknown' }
  if (text.split(/\s+/).length > MAX_REPLY_WORDS) return { action: 'unknown' }

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

  if ((DONE_BARE.test(text) || DONE_PRONOUN.test(text)) && !isCommand) return { action: 'done' }

  return { action: 'unknown' }
}

/**
 * With the conversational agent on, only a bare reply ("done", "snooze 3d",
 * "not interested", "called him") is decided here; anything longer goes to the
 * agent, which reads it in context and has a tool for reminder replies.
 */
export function parseBareReminderReply(raw: string | null | undefined): ReminderReply {
  const text = (raw ?? '').trim()
  if (text.split(/\s+/).length > 5) return { action: 'unknown' }
  return parseReminderReply(text)
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

/**
 * A message that is NOTHING BUT a yes or a no — for the conversational agent.
 *
 * parseConfirmation reads only the first word, so "yes but she's a renter not
 * a buyer" saves her as a buyer, and "no, the phone is 03 123 456" throws the
 * whole client away. Under the agent, anything beyond a bare yes or no goes to
 * the model instead, which sees the waiting change and prepares a corrected
 * one; a plain "yes" is still committed here, by code the model never touches.
 *
 * A question mark always means it isn't a confirmation: in Lebanese "eh" is
 * yes, and "eh?" is "what?".
 */
const BARE_CONFIRM = new Set([
  'yes', 'y', 'yeah', 'yea', 'yep', 'yup', 'ya', 'ok', 'okay', 'ok ok', 'k', 'kk', 'sure', 'confirm', 'confirmed',
  'correct', 'go ahead', 'do it', 'save', 'save it', 'yes please', 'yes save', 'yes save it', 'ok save',
  'yes go ahead', 'ok go ahead', 'perfect', 'approved',
  // Not here on purpose: "done" (also the answer to a follow-up reminder),
  // "great" / "good" (as often a reaction as an approval). A false yes saves
  // something; a false "unknown" only means the model asks.
  // Lebanese / Arabizi
  'eh', 'ee', 'aywa', 'akid', 'tamam', 'tamem', 'yalla', 'eh akid',
  'نعم', 'اي', 'ايه', 'أكيد', 'تمام',
  '👍', '✅', '👌',
])
const BARE_CANCEL = new Set([
  'no', 'n', 'nope', 'nah', 'cancel', 'stop', 'abort', 'discard', 'nevermind', 'never mind',
  'dont', 'don\'t', 'dont save', 'don\'t save', 'no thanks', 'no thank you', 'cancel it', 'forget it',
  // Lebanese / Arabizi
  // خلص is left out: it can mean "that's it, go" as easily as "stop".
  'la', 'la2', 'la ma baddi', 'لا', 'لأ',
  '👎', '❌',
])

export function parseBareConfirmation(raw: string | null | undefined): Confirmation {
  const text = String(raw ?? '').trim()
  if (!text || text.includes('?')) return 'unknown'
  const core = text
    .toLowerCase()
    .replace(/[.!،,\s]+$/u, '')     // trailing punctuation: "yes!" "ok." "eh,"
    .replace(/\s+/g, ' ')
    .trim()
  if (BARE_CONFIRM.has(core)) return 'confirm'
  if (BARE_CANCEL.has(core)) return 'cancel'
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
