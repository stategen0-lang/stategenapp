// Calendar logic: building the month grid, placing events on days, and
// validating what a user typed.
//
// Pure and dependency-free so the fiddly parts — month boundaries, all-day
// events, multi-day spans, DST — are unit-testable without a database, a
// browser or a clock.

export type EventKind = 'viewing' | 'meeting' | 'call' | 'follow_up' | 'other'

export const EVENT_KINDS: { id: EventKind; label: string; color: string; bg: string }[] = [
  { id: 'viewing',   label: 'Viewing',   color: '#1F7A4D', bg: '#E3F4EA' },
  { id: 'meeting',   label: 'Meeting',   color: '#2E5288', bg: '#EAF0FA' },
  { id: 'call',      label: 'Call',      color: '#9A6516', bg: '#FBEFD6' },
  { id: 'follow_up', label: 'Follow-up', color: '#6B4FA8', bg: '#EFEAFA' },
  { id: 'other',     label: 'Other',     color: '#6A7488', bg: '#F0F2F5' },
]

export function kindStyle(kind: string) {
  return EVENT_KINDS.find(k => k.id === kind) ?? EVENT_KINDS[EVENT_KINDS.length - 1]
}

export function isEventKind(v: unknown): v is EventKind {
  return EVENT_KINDS.some(k => k.id === v)
}

export interface CalendarEvent {
  id: string
  company_id: number
  profile_id: string
  agent_code: string | null
  title: string
  notes: string | null
  kind: EventKind
  starts_at: string      // ISO
  ends_at: string        // ISO
  all_day: boolean
  location: string | null
  client_id: number | null
  property_id: number | null
  /** Filled in by the API for display. */
  agentName?: string
  clientName?: string | null
}

// ── Day keys ────────────────────────────────────────────────────────────────
// A "day" is the viewer's local calendar day. Events are stored as UTC
// instants, so the key must come from local getters — using toISOString().slice
// would put a 9pm Beirut appointment on the following day for half the year.

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function addMonths(d: Date, n: number): Date {
  // Anchor to the 1st before shifting: adding a month to the 31st otherwise
  // skips a month entirely (31 Jan + 1 → 2 Mar).
  const out = new Date(d.getFullYear(), d.getMonth() + n, 1)
  return out
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b)
}

// ── Month grid ──────────────────────────────────────────────────────────────

export interface GridDay {
  key: string
  date: Date
  inMonth: boolean
  isToday: boolean
}

/**
 * Six weeks of days covering `month`, starting on Monday.
 *
 * Always 42 cells: a grid that changes height between months makes the whole
 * page jump when you page through it.
 */
export function monthGrid(month: Date, today: Date = new Date()): GridDay[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  // getDay(): 0=Sun. Monday-first means Sunday is 6 days from the start.
  const offset = (first.getDay() + 6) % 7
  const start = addDays(first, -offset)

  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i)
    return {
      key: dayKey(date),
      date,
      inMonth: date.getMonth() === month.getMonth(),
      isToday: sameDay(date, today),
    }
  })
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function monthLabel(month: Date): string {
  return month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// ── Placing events on days ──────────────────────────────────────────────────

/**
 * Every local day an event touches. A viewing from Friday 22:00 to Saturday
 * 01:00 belongs on both days, or it vanishes from one of them.
 */
export function eventDayKeys(event: Pick<CalendarEvent, 'starts_at' | 'ends_at'>): string[] {
  const start = new Date(event.starts_at)
  const end = new Date(event.ends_at)
  if (Number.isNaN(start.getTime())) return []
  const last = Number.isNaN(end.getTime()) ? start : end

  const keys: string[] = []
  let cursor = startOfDay(start)
  const stop = startOfDay(last)
  // Guard against absurd ranges rather than looping forever on bad data.
  for (let i = 0; i <= 366 && cursor <= stop; i++) {
    keys.push(dayKey(cursor))
    cursor = addDays(cursor, 1)
  }
  return keys.length ? keys : [dayKey(start)]
}

/** Index events by day key, each day sorted by start time. */
export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    for (const key of eventDayKeys(e)) {
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    }
  }
  for (const list of map.values()) list.sort(compareEvents)
  return map
}

/** All-day events first, then by start time, then by title for stability. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1
  const diff = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  if (diff) return diff
  return (a.title ?? '').localeCompare(b.title ?? '')
}

/** The UTC instants bounding the six-week grid, for querying the server. */
export function monthRange(month: Date): { from: string; to: string } {
  const grid = monthGrid(month)
  const from = startOfDay(grid[0].date)
  const to = addDays(startOfDay(grid[grid.length - 1].date), 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "14:30 – 15:30", "All day", or "Tue 14:30 → Wed 01:00" when it spans days. */
export function formatRange(event: Pick<CalendarEvent, 'starts_at' | 'ends_at' | 'all_day'>): string {
  if (event.all_day) return 'All day'
  const start = new Date(event.starts_at)
  const end = new Date(event.ends_at)
  if (Number.isNaN(start.getTime())) return ''
  if (Number.isNaN(end.getTime()) || end.getTime() === start.getTime()) return formatTime(event.starts_at)
  if (sameDay(start, end)) return `${formatTime(event.starts_at)} – ${formatTime(event.ends_at)}`
  const day = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' })
  return `${day(start)} ${formatTime(event.starts_at)} → ${day(end)} ${formatTime(event.ends_at)}`
}

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Round up to a half-hour — the default start for a new event.
 *
 * Already exactly on :00 or :30 is left alone; pushing 10:00 out to 10:30 would
 * make "add an event now" default to half an hour from now for no reason.
 */
export function nextHalfHour(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setSeconds(0, 0)
  const remainder = d.getMinutes() % 30
  if (remainder !== 0) d.setMinutes(d.getMinutes() + (30 - remainder))
  return d
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface EventDraft {
  title?: string
  kind?: string
  starts_at?: string
  ends_at?: string
  all_day?: boolean
  notes?: string
  location?: string
  client_id?: number | null
  property_id?: number | null
}

export interface EventValues {
  title: string
  kind: EventKind
  starts_at: string
  ends_at: string
  all_day: boolean
  notes: string | null
  location: string | null
  client_id: number | null
  property_id: number | null
}

/**
 * A discriminated union rather than an optional `value`: callers that check
 * `ok` then get `value` without a non-null assertion, and "valid but no value"
 * cannot be represented.
 */
export type ValidationResult =
  | { ok: true; errors: string[]; value: EventValues }
  | { ok: false; errors: string[]; value?: undefined }

const MAX_TITLE = 200
const MAX_TEXT = 2000

/**
 * Validate a draft. Used by the API (authoritative) and the form (immediate
 * feedback), so the two can never disagree about what is acceptable.
 */
export function validateEvent(draft: EventDraft): ValidationResult {
  const errors: string[] = []

  const title = String(draft.title ?? '').trim()
  if (!title) errors.push('Give the event a title.')
  if (title.length > MAX_TITLE) errors.push(`Title must be under ${MAX_TITLE} characters.`)

  const kind = isEventKind(draft.kind) ? draft.kind : 'meeting'

  const start = new Date(String(draft.starts_at ?? ''))
  if (Number.isNaN(start.getTime())) errors.push('Pick a start date and time.')

  // An end is optional: default to an hour after the start rather than making
  // the user set it for what is usually a one-hour appointment.
  let end = draft.ends_at ? new Date(String(draft.ends_at)) : new Date(start.getTime() + 3600_000)
  if (draft.ends_at && Number.isNaN(end.getTime())) errors.push('That end time is not valid.')

  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
    errors.push('The event ends before it starts.')
  }

  const all_day = !!draft.all_day
  if (all_day && !Number.isNaN(start.getTime())) {
    // Normalise to the whole local day so all-day events sort and render
    // consistently regardless of the time that happened to be submitted.
    const from = startOfDay(start)
    const to = addDays(from, 1)
    return finish(errors, {
      title, kind, all_day,
      starts_at: from.toISOString(),
      ends_at: new Date(to.getTime() - 1000).toISOString(),
      notes: text(draft.notes),
      location: text(draft.location),
      client_id: id(draft.client_id),
      property_id: id(draft.property_id),
    })
  }

  return finish(errors, {
    title, kind, all_day,
    starts_at: Number.isNaN(start.getTime()) ? '' : start.toISOString(),
    ends_at: Number.isNaN(end.getTime()) ? '' : end.toISOString(),
    notes: text(draft.notes),
    location: text(draft.location),
    client_id: id(draft.client_id),
    property_id: id(draft.property_id),
  })
}

function finish(errors: string[], value: EventValues): ValidationResult {
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], value }
}

function text(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, MAX_TEXT) : null
}

function id(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
