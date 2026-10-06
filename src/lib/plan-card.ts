// What the "Your plan" card on Settings says — the wording for the renewal line
// and the user-limit meter, kept pure (no React, no network) so it is tested on
// its own. Client-safe.

export type Tone = 'ok' | 'warn' | 'bad' | 'muted'

/** Accounts activated before billing dates existed carry a placeholder
 *  paid-through date of 2100-01-01 (migration 012). That is "no end date", not
 *  a real renewal, so it must never be shown as one. */
const OPEN_ENDED_FROM_YEAR = 2090

const DAY_MS = 86_400_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Fixed month names, not toLocaleDateString: different browsers and Node
// versions spell September "Sep" or "Sept", and the card should read the same
// on every phone.
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export interface Renewal { text: string; tone: Tone; daysLeft: number | null }

export function renewalInfo(
  status: string | null | undefined,
  until: string | null | undefined,
  now: Date = new Date(),
): Renewal {
  const end = until ? new Date(until) : null
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null

  switch (status) {
    case 'active': {
      if (!validEnd || validEnd.getUTCFullYear() >= OPEN_ENDED_FROM_YEAR) {
        return { text: 'No end date set', tone: 'muted', daysLeft: null }
      }
      const daysLeft = Math.ceil((validEnd.getTime() - now.getTime()) / DAY_MS)
      if (daysLeft <= 0) return { text: `Ended ${fmtDate(until!)}`, tone: 'bad', daysLeft: 0 }
      return {
        text: `Paid through ${fmtDate(until!)} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`,
        tone: daysLeft <= 7 ? 'warn' : 'ok',
        daysLeft,
      }
    }
    case 'pending':   return { text: 'Waiting to be activated', tone: 'warn', daysLeft: null }
    case 'expired':   return { text: validEnd ? `Ended ${fmtDate(until!)}` : 'Subscription ended', tone: 'bad', daysLeft: 0 }
    case 'suspended': return { text: 'Suspended — contact StateGen', tone: 'bad', daysLeft: null }
    default:          return { text: 'Not active', tone: 'bad', daysLeft: null }
  }
}

export interface Seats {
  /** 0–100 for the meter, or null when there is no cap to measure against. */
  pct: number | null
  tone: Tone
  text: string
  /** A one-line nudge when the agency is close to or at its limit. */
  note: string | null
}

/** `limit` null = no cap (Enterprise). `used` counts managers and approved agents. */
export function seatState(used: number, limit: number | null): Seats {
  const u = Math.max(0, Math.floor(used) || 0)
  if (limit == null) {
    return { pct: null, tone: 'ok', text: `${u} user${u === 1 ? '' : 's'} · no limit`, note: null }
  }
  const pct = limit > 0 ? Math.min(100, Math.round((u / limit) * 100)) : 100
  const text = `${u} of ${limit} users`
  if (u >= limit) {
    return { pct, tone: 'bad', text, note: "You're at your limit — contact StateGen to move to a bigger plan." }
  }
  if (pct >= 80) {
    const left = limit - u
    return { pct, tone: 'warn', text, note: `${left} user${left === 1 ? '' : 's'} left before you reach your limit.` }
  }
  return { pct, tone: 'ok', text, note: null }
}

export const TONE_STYLE: Record<Tone, { bg: string; color: string }> = {
  ok:    { bg: '#E3F4EA', color: '#1F7A4D' },
  warn:  { bg: '#FBEFD6', color: '#9A6516' },
  bad:   { bg: '#FBE7E7', color: '#A23434' },
  muted: { bg: '#F0F2F5', color: '#6A7488' },
}
