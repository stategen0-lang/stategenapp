// Turning "tomorrow at 3pm" into an actual instant.
//
// Deterministic on purpose. Grok can read a date, but this runs on every event
// an agent adds from their phone, and a model that occasionally puts a viewing
// on the wrong day is worse than one that admits it didn't understand — the
// agent turns up at the wrong time and only finds out when nobody's there.
//
// Anything this cannot parse returns null, and the caller asks rather than
// guessing. Pure, so every phrasing below is unit-tested.

export interface ParsedWhen {
  /** Local instant the event starts. */
  start: Date
  /** True when no time of day was given, so the whole day is meant. */
  allDay: boolean
  /** The words consumed, so the caller can strip them from a title. */
  matched: string
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

// ── Time of day ─────────────────────────────────────────────────────────────

interface ParsedTime { hours: number; minutes: number; matched: string }

/**
 * "3pm", "3:30 pm", "15:00", "at 9", "noon". Returns null when the message
 * carries no time.
 */
export function parseTime(text: string): ParsedTime | null {
  const s = text.toLowerCase()

  if (/\bnoon\b|\bmidday\b/.test(s)) return { hours: 12, minutes: 0, matched: 'noon' }
  if (/\bmidnight\b/.test(s)) return { hours: 0, minutes: 0, matched: 'midnight' }

  // "3pm", "3.30pm", "3:30 p.m."
  const meridiem = s.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/)
  if (meridiem) {
    let h = parseInt(meridiem[1], 10)
    const m = meridiem[2] ? parseInt(meridiem[2], 10) : 0
    const pm = meridiem[3].startsWith('p')
    if (h > 12 || m > 59) return null
    if (pm && h !== 12) h += 12
    if (!pm && h === 12) h = 0
    return { hours: h, minutes: m, matched: meridiem[0] }
  }

  // 24-hour "15:00", "at 15h"
  const h24 = s.match(/\b(\d{1,2}):(\d{2})\b/) || s.match(/\b(\d{1,2})h\b/)
  if (h24) {
    const h = parseInt(h24[1], 10)
    const m = h24[2] ? parseInt(h24[2], 10) : 0
    if (h > 23 || m > 59) return null
    return { hours: h, minutes: m, matched: h24[0] }
  }

  // "at 9", "at 5" — bare hour, only after "at" so it can't eat a bedroom count.
  const bare = s.match(/\bat\s+(\d{1,2})\b(?!\s*(?:sqm|m2|bed|bath|k\b))/)
  if (bare) {
    let h = parseInt(bare[1], 10)
    if (h > 23) return null
    // A working day: "at 8" means 8am, "at 5" means 5pm.
    if (h >= 1 && h <= 7) h += 12
    return { hours: h, minutes: 0, matched: bare[0] }
  }

  return null
}

// ── Day ─────────────────────────────────────────────────────────────────────

interface ParsedDay { date: Date; matched: string }

/** "today", "tomorrow", "monday", "next friday", "15/7", "15 July". */
export function parseDay(text: string, now: Date): ParsedDay | null {
  const s = text.toLowerCase()
  const today = startOfDay(now)

  if (/\btoday\b|\btonight\b|\bthis evening\b|\bthis afternoon\b|\bthis morning\b/.test(s)) {
    return { date: today, matched: 'today' }
  }
  // Checked before plain "tomorrow", which otherwise matches inside it and
  // books the event a day early.
  if (/\bday after tomorrow\b/.test(s)) return { date: addDays(today, 2), matched: 'day after tomorrow' }
  if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(s)) return { date: addDays(today, 1), matched: 'tomorrow' }

  // "in 3 days"
  const inDays = s.match(/\bin\s+(\d{1,2})\s+days?\b/)
  if (inDays) return { date: addDays(today, parseInt(inDays[1], 10)), matched: inDays[0] }
  const inWeeks = s.match(/\bin\s+(\d{1,2})\s+weeks?\b/)
  if (inWeeks) return { date: addDays(today, parseInt(inWeeks[1], 10) * 7), matched: inWeeks[0] }

  // Day names: "saturday", "next saturday", "this saturday".
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(next\\s+|this\\s+)?(${DAY_NAMES[i]}|${DAY_ABBR[i]})\\b`)
    const m = s.match(re)
    if (!m) continue
    const wantsNext = /next/.test(m[1] ?? '')
    let delta = (i - today.getDay() + 7) % 7
    // A bare day name means the next one that hasn't happened; "next X" always
    // skips a week when X is today or already this week.
    if (delta === 0) delta = 7
    if (wantsNext && delta < 7) delta += 7
    return { date: addDays(today, delta), matched: m[0] }
  }

  // "15/7", "15-07", "15/7/2026" — day first, as written in Lebanon.
  const numeric = s.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/)
  if (numeric) {
    const day = parseInt(numeric[1], 10)
    const month = parseInt(numeric[2], 10)
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      let year = numeric[3] ? parseInt(numeric[3], 10) : now.getFullYear()
      if (year < 100) year += 2000
      const date = new Date(year, month - 1, day)
      // A bare day/month that has already passed means next year.
      if (!numeric[3] && date < today) date.setFullYear(year + 1)
      if (date.getDate() === day) return { date, matched: numeric[0] }
    }
  }

  // "15 July", "July 15", "15 Jul"
  for (let i = 0; i < 12; i++) {
    const name = MONTHS[i]
    const abbr = name.slice(0, 3)
    const re = new RegExp(`\\b(?:(\\d{1,2})\\s+(${name}|${abbr})|(${name}|${abbr})\\s+(\\d{1,2}))\\b`)
    const m = s.match(re)
    if (!m) continue
    const day = parseInt(m[1] ?? m[4], 10)
    if (!(day >= 1 && day <= 31)) continue
    const date = new Date(now.getFullYear(), i, day)
    if (date < today) date.setFullYear(now.getFullYear() + 1)
    if (date.getDate() === day) return { date, matched: m[0] }
  }

  return null
}

// ── Combined ────────────────────────────────────────────────────────────────

/**
 * Read a day and optional time out of a message.
 *
 * A day with no time is treated as all-day rather than assuming an hour: an
 * event silently placed at 9am that the agent meant for the afternoon is a
 * missed appointment, whereas an all-day entry is visibly imprecise.
 */
export function parseWhen(text: string, now: Date = new Date()): ParsedWhen | null {
  if (!text || !text.trim()) return null

  const day = parseDay(text, now)
  const time = parseTime(text)

  // A time with no day means today, or tomorrow if that hour has passed.
  if (!day && time) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hours, time.minutes)
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1)
    return { start: candidate, allDay: false, matched: time.matched }
  }

  if (!day) return null

  if (!time) return { start: day.date, allDay: true, matched: day.matched }

  const start = new Date(day.date)
  start.setHours(time.hours, time.minutes, 0, 0)
  return { start, allDay: false, matched: `${day.matched} ${time.matched}`.trim() }
}

/** Human summary for the confirmation message. */
export function describeWhen(when: ParsedWhen): string {
  const date = when.start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  if (when.allDay) return `${date} (all day)`
  const time = when.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date} at ${time}`
}
