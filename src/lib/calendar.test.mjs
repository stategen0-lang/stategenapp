// Unit tests for calendar logic (src/lib/calendar.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dayKey, parseDayKey, startOfDay, addDays, addMonths, sameDay,
  monthGrid, monthLabel, monthRange, WEEKDAYS,
  eventDayKeys, groupByDay, compareEvents,
  formatRange, toLocalInput, nextHalfHour,
  validateEvent, isEventKind, kindStyle, EVENT_KINDS,
} from './calendar.ts'

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
const iso = (y, m, d, h = 0, min = 0) => at(y, m, d, h, min).toISOString()

const ev = (o = {}) => ({
  id: 'e1', company_id: 1, profile_id: 'p1', agent_code: 'a1',
  title: 'Viewing', notes: null, kind: 'viewing',
  starts_at: iso(2026, 7, 15, 10, 0), ends_at: iso(2026, 7, 15, 11, 0),
  all_day: false, location: null, client_id: null, property_id: null,
  ...o,
})

// ── Day keys ────────────────────────────────────────────────────────────────
test('dayKey: uses the local calendar day, not UTC', () => {
  // A 23:00 local appointment must stay on its own day even when UTC has
  // already rolled over — toISOString().slice(0,10) would move it.
  assert.equal(dayKey(at(2026, 7, 15, 23, 30)), '2026-07-15')
  assert.equal(dayKey(at(2026, 7, 15, 0, 15)), '2026-07-15')
})
test('dayKey: zero-pads', () => {
  assert.equal(dayKey(at(2026, 1, 5)), '2026-01-05')
})
test('parseDayKey round-trips', () => {
  assert.equal(dayKey(parseDayKey('2026-03-09')), '2026-03-09')
})
test('startOfDay strips the time', () => {
  const d = startOfDay(at(2026, 7, 15, 17, 45))
  assert.equal(d.getHours(), 0)
  assert.equal(dayKey(d), '2026-07-15')
})
test('addDays crosses month and year boundaries', () => {
  assert.equal(dayKey(addDays(at(2026, 1, 31), 1)), '2026-02-01')
  assert.equal(dayKey(addDays(at(2026, 12, 31), 1)), '2027-01-01')
  assert.equal(dayKey(addDays(at(2026, 3, 1), -1)), '2026-02-28')
})
test('addMonths does not skip a month from the 31st', () => {
  // Naive month arithmetic turns 31 Jan + 1 month into 2 March.
  assert.equal(dayKey(addMonths(at(2026, 1, 31), 1)), '2026-02-01')
  assert.equal(dayKey(addMonths(at(2026, 12, 15), 1)), '2027-01-01')
  assert.equal(dayKey(addMonths(at(2026, 1, 15), -1)), '2025-12-01')
})
test('sameDay ignores the time', () => {
  assert.equal(sameDay(at(2026, 7, 15, 1), at(2026, 7, 15, 23)), true)
  assert.equal(sameDay(at(2026, 7, 15), at(2026, 7, 16)), false)
})

// ── Month grid ──────────────────────────────────────────────────────────────
test('monthGrid: always six weeks, so the page never jumps', () => {
  for (const m of [at(2026, 2, 1), at(2026, 7, 1), at(2026, 8, 1)]) {
    assert.equal(monthGrid(m).length, 42, monthLabel(m))
  }
})
test('monthGrid: starts on a Monday', () => {
  const grid = monthGrid(at(2026, 7, 1))
  assert.equal(grid[0].date.getDay(), 1)
  assert.equal(WEEKDAYS[0], 'Mon')
})
test('monthGrid: includes the leading and trailing days of adjacent months', () => {
  // 1 July 2026 is a Wednesday, so the grid opens on Monday 29 June.
  const grid = monthGrid(at(2026, 7, 1))
  assert.equal(grid[0].key, '2026-06-29')
  assert.equal(grid[0].inMonth, false)
  assert.equal(grid.find(d => d.key === '2026-07-01').inMonth, true)
  assert.equal(grid[41].inMonth, false)
})
test('monthGrid: every day of the month is present exactly once', () => {
  const grid = monthGrid(at(2026, 7, 1))
  const inMonth = grid.filter(d => d.inMonth).map(d => d.key)
  assert.equal(inMonth.length, 31)
  assert.equal(new Set(inMonth).size, 31)
})
test('monthGrid: handles a February that starts on a Monday', () => {
  const grid = monthGrid(at(2027, 2, 1))
  assert.equal(grid[0].key, '2027-02-01')
  assert.equal(grid.filter(d => d.inMonth).length, 28)
})
test('monthGrid: marks today only on the real today', () => {
  const grid = monthGrid(at(2026, 7, 1), at(2026, 7, 15))
  assert.equal(grid.filter(d => d.isToday).length, 1)
  assert.equal(grid.find(d => d.isToday).key, '2026-07-15')
})
test('monthRange: covers the whole visible grid', () => {
  const { from, to } = monthRange(at(2026, 7, 1))
  assert.equal(new Date(from) <= at(2026, 6, 29), true)
  assert.equal(new Date(to) > at(2026, 8, 9), true)
})

// ── Placing events ──────────────────────────────────────────────────────────
test('eventDayKeys: a normal event lands on one day', () => {
  assert.deepEqual(eventDayKeys(ev()), ['2026-07-15'])
})
test('eventDayKeys: an overnight event lands on both days', () => {
  const e = ev({ starts_at: iso(2026, 7, 15, 22, 0), ends_at: iso(2026, 7, 16, 1, 0) })
  assert.deepEqual(eventDayKeys(e), ['2026-07-15', '2026-07-16'])
})
test('eventDayKeys: a multi-day event covers every day in between', () => {
  const e = ev({ starts_at: iso(2026, 7, 15, 9, 0), ends_at: iso(2026, 7, 18, 17, 0) })
  assert.deepEqual(eventDayKeys(e), ['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'])
})
test('eventDayKeys: bad dates do not throw or loop', () => {
  assert.deepEqual(eventDayKeys({ starts_at: 'nonsense', ends_at: 'nonsense' }), [])
  const e = { starts_at: iso(2026, 7, 15), ends_at: 'nonsense' }
  assert.deepEqual(eventDayKeys(e), ['2026-07-15'])
})
test('groupByDay: indexes by day and sorts within each day', () => {
  const late = ev({ id: 'late', starts_at: iso(2026, 7, 15, 16, 0), ends_at: iso(2026, 7, 15, 17, 0) })
  const early = ev({ id: 'early', starts_at: iso(2026, 7, 15, 9, 0), ends_at: iso(2026, 7, 15, 10, 0) })
  const map = groupByDay([late, early])
  assert.deepEqual(map.get('2026-07-15').map(e => e.id), ['early', 'late'])
})
test('groupByDay: a multi-day event appears on each of its days', () => {
  const e = ev({ id: 'trip', starts_at: iso(2026, 7, 15, 9), ends_at: iso(2026, 7, 17, 9) })
  const map = groupByDay([e])
  assert.deepEqual([...map.keys()].sort(), ['2026-07-15', '2026-07-16', '2026-07-17'])
})
test('compareEvents: all-day first, then by time', () => {
  const allDay = ev({ id: 'ad', all_day: true, starts_at: iso(2026, 7, 15, 23) })
  const morning = ev({ id: 'am', starts_at: iso(2026, 7, 15, 8) })
  assert.deepEqual([morning, allDay].sort(compareEvents).map(e => e.id), ['ad', 'am'])
})
test('compareEvents: identical times fall back to title', () => {
  const a = ev({ id: 'a', title: 'Alpha' })
  const b = ev({ id: 'b', title: 'Beta' })
  assert.deepEqual([b, a].sort(compareEvents).map(e => e.id), ['a', 'b'])
})

// ── Formatting ──────────────────────────────────────────────────────────────
test('formatRange: all-day says so', () => {
  assert.equal(formatRange(ev({ all_day: true })), 'All day')
})
test('formatRange: same-day shows a start and end', () => {
  const s = formatRange(ev())
  assert.match(s, /–/)
})
test('formatRange: crossing midnight names both days', () => {
  const s = formatRange(ev({ starts_at: iso(2026, 7, 15, 22), ends_at: iso(2026, 7, 16, 1) }))
  assert.match(s, /→/)
})
test('formatRange: a zero-length event shows a single time', () => {
  const t = iso(2026, 7, 15, 10)
  assert.equal(/–|→/.test(formatRange({ starts_at: t, ends_at: t, all_day: false })), false)
})
test('toLocalInput: shape a datetime-local input accepts', () => {
  assert.match(toLocalInput(at(2026, 7, 5, 9, 5)), /^2026-07-05T09:05$/)
})
test('nextHalfHour: rounds up to the next half-hour', () => {
  assert.equal(toLocalInput(nextHalfHour(at(2026, 7, 15, 10, 1))), '2026-07-15T10:30')
  assert.equal(toLocalInput(nextHalfHour(at(2026, 7, 15, 10, 29))), '2026-07-15T10:30')
  assert.equal(toLocalInput(nextHalfHour(at(2026, 7, 15, 10, 31))), '2026-07-15T11:00')
  assert.equal(toLocalInput(nextHalfHour(at(2026, 7, 15, 10, 59))), '2026-07-15T11:00')
})
test('nextHalfHour: leaves an exact half-hour alone', () => {
  // Otherwise "add an event now" at 10:00 defaults to 10:30 for no reason.
  assert.equal(toLocalInput(nextHalfHour(at(2026, 7, 15, 10, 0))), '2026-07-15T10:00')
  assert.equal(toLocalInput(nextHalfHour(at(2026, 7, 15, 10, 30))), '2026-07-15T10:30')
})
test('nextHalfHour: clears seconds so times are round', () => {
  const d = nextHalfHour(new Date(2026, 6, 15, 10, 1, 47))
  assert.equal(d.getSeconds(), 0)
})

// ── Kinds ───────────────────────────────────────────────────────────────────
test('isEventKind accepts only the defined kinds', () => {
  assert.equal(isEventKind('viewing'), true)
  assert.equal(isEventKind('party'), false)
})
test('kindStyle falls back to "other" rather than crashing', () => {
  assert.equal(kindStyle('nonsense').id, 'other')
  assert.equal(kindStyle('viewing').label, 'Viewing')
  assert.equal(new Set(EVENT_KINDS.map(k => k.color)).size, EVENT_KINDS.length)
})

// ── Validation ──────────────────────────────────────────────────────────────
test('validateEvent: accepts a normal event', () => {
  const r = validateEvent({ title: 'Viewing with Ahmed', kind: 'viewing', starts_at: iso(2026, 7, 15, 10) })
  assert.equal(r.ok, true)
  assert.equal(r.value.title, 'Viewing with Ahmed')
  assert.equal(r.value.kind, 'viewing')
})
test('validateEvent: a missing end defaults to one hour', () => {
  const r = validateEvent({ title: 'Call', starts_at: iso(2026, 7, 15, 10) })
  const mins = (new Date(r.value.ends_at) - new Date(r.value.starts_at)) / 60000
  assert.equal(mins, 60)
})
test('validateEvent: requires a title', () => {
  const r = validateEvent({ starts_at: iso(2026, 7, 15, 10) })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /title/i)
})
test('validateEvent: requires a valid start', () => {
  assert.equal(validateEvent({ title: 'X' }).ok, false)
  assert.equal(validateEvent({ title: 'X', starts_at: 'nonsense' }).ok, false)
})
test('validateEvent: rejects an end before the start', () => {
  const r = validateEvent({ title: 'X', starts_at: iso(2026, 7, 15, 12), ends_at: iso(2026, 7, 15, 11) })
  assert.equal(r.ok, false)
  assert.match(r.errors.join(' '), /ends before/i)
})
test('validateEvent: an unknown kind falls back to meeting, not an error', () => {
  const r = validateEvent({ title: 'X', kind: 'party', starts_at: iso(2026, 7, 15, 10) })
  assert.equal(r.ok, true)
  assert.equal(r.value.kind, 'meeting')
})
test('validateEvent: all-day covers the whole local day', () => {
  const r = validateEvent({ title: 'Open house', all_day: true, starts_at: iso(2026, 7, 15, 14, 37) })
  assert.equal(r.ok, true)
  assert.equal(dayKey(new Date(r.value.starts_at)), '2026-07-15')
  assert.equal(dayKey(new Date(r.value.ends_at)), '2026-07-15')
  assert.equal(new Date(r.value.starts_at).getHours(), 0)
})
test('validateEvent: trims and length-caps text', () => {
  const r = validateEvent({ title: '  Viewing  ', notes: '  note  ', starts_at: iso(2026, 7, 15, 10) })
  assert.equal(r.value.title, 'Viewing')
  assert.equal(r.value.notes, 'note')
  assert.equal(validateEvent({ title: 'x'.repeat(300), starts_at: iso(2026, 7, 15, 10) }).ok, false)
})
test('validateEvent: blank optional text becomes null, not ""', () => {
  const r = validateEvent({ title: 'X', notes: '   ', location: '', starts_at: iso(2026, 7, 15, 10) })
  assert.equal(r.value.notes, null)
  assert.equal(r.value.location, null)
})
test('validateEvent: ignores junk record links', () => {
  const r = validateEvent({ title: 'X', starts_at: iso(2026, 7, 15, 10), client_id: 'abc', property_id: 0 })
  assert.equal(r.value.client_id, null)
  assert.equal(r.value.property_id, null)
})
test('validateEvent: keeps valid record links', () => {
  const r = validateEvent({ title: 'X', starts_at: iso(2026, 7, 15, 10), client_id: 7, property_id: '12' })
  assert.equal(r.value.client_id, 7)
  assert.equal(r.value.property_id, 12)
})
test('validateEvent: reports every problem at once', () => {
  const r = validateEvent({ starts_at: 'nonsense' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.length >= 2, JSON.stringify(r.errors))
})
