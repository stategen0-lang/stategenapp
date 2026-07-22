// Wall-clock time in the agency's timezone.
//
// The server runs in UTC on Vercel and in Beirut time on a developer's laptop.
// Anything built with `new Date(y, m, d, h, ...)` therefore means different
// instants in the two places: "book a viewing at 3pm" was stored as 15:00 UTC
// in production, which is 6pm in Beirut. It only looked right locally.
//
// Everything the bot does with dates — parsing "tomorrow at 3pm", deciding what
// "today" means for the agenda, printing a time back to the agent — has to be
// anchored to the agency's zone, not the machine's.

/** IANA zone for the agency. Configurable, since not every deployment is here. */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Beirut'

export interface WallClock {
  year: number
  month: number   // 1-12
  day: number     // 1-31
  hour: number
  minute: number
  /** 0 = Sunday, matching Date#getDay. */
  weekday: number
}

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short',
  hour12: false,
})

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/** What the clock reads in the agency's zone at a given instant. */
export function wallClock(instant: Date = new Date()): WallClock {
  const parts = Object.fromEntries(
    PARTS.formatToParts(instant).map(p => [p.type, p.value]),
  ) as Record<string, string>

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some environments under hour12:false.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  }
}

/**
 * The instant at which the agency's clock reads the given wall time.
 *
 * Iterated twice rather than applying a fixed offset: the offset itself depends
 * on the instant, so a single pass lands in the wrong hour across a DST change.
 */
export function toInstant(w: {
  year: number; month: number; day: number; hour?: number; minute?: number
}): Date {
  const target = Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 0, w.minute ?? 0)
  let guess = target

  for (let i = 0; i < 2; i++) {
    const seen = wallClock(new Date(guess))
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute)
    const offset = seenAsUtc - guess
    guess = target - offset
  }

  return new Date(guess)
}

/** Midnight in the agency's zone, on the day containing `instant`. */
export function startOfZonedDay(instant: Date = new Date()): Date {
  const w = wallClock(instant)
  return toInstant({ year: w.year, month: w.month, day: w.day })
}

/** Midnight `days` after the day containing `instant`. */
export function addZonedDays(instant: Date, days: number): Date {
  const w = wallClock(instant)
  // Date.UTC normalises overflow (32 January becomes 1 February).
  const shifted = new Date(Date.UTC(w.year, w.month - 1, w.day + days))
  return toInstant({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  })
}

/** Do these two instants fall on the same day in the agency's zone? */
export function sameZonedDay(a: Date, b: Date): boolean {
  const x = wallClock(a)
  const y = wallClock(b)
  return x.year === y.year && x.month === y.month && x.day === y.day
}

// ── Formatting, always in the agency's zone ─────────────────────────────────

export function formatZonedTime(instant: Date): string {
  return instant.toLocaleTimeString('en-US', {
    timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit',
  })
}

export function formatZonedDate(instant: Date): string {
  return instant.toLocaleDateString('en-GB', {
    timeZone: APP_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long',
  })
}
