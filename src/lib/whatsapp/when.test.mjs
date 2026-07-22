// Unit tests for natural-language date parsing (src/lib/whatsapp/when.ts).
//
// This decides when an agent turns up to a viewing. A wrong answer is worse
// than no answer, so the "refuses to guess" cases are tested as hard as the
// successful ones.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWhen, parseDay, parseTime, describeWhen } from './when.ts'

// Wednesday 22 July 2026, 10:00 local.
const NOW = new Date(2026, 6, 22, 10, 0, 0)
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// ── Time of day ─────────────────────────────────────────────────────────────
test('parseTime: 12-hour with meridiem', () => {
  assert.deepEqual(pick(parseTime('at 3pm')), [15, 0])
  assert.deepEqual(pick(parseTime('3:30 pm')), [15, 30])
  assert.deepEqual(pick(parseTime('9am')), [9, 0])
  assert.deepEqual(pick(parseTime('10.15am')), [10, 15])
})
test('parseTime: noon and midnight edge cases', () => {
  assert.deepEqual(pick(parseTime('12pm')), [12, 0])
  assert.deepEqual(pick(parseTime('12am')), [0, 0])
  assert.deepEqual(pick(parseTime('at noon')), [12, 0])
})
test('parseTime: 24-hour', () => {
  assert.deepEqual(pick(parseTime('15:00')), [15, 0])
  assert.deepEqual(pick(parseTime('at 09:30')), [9, 30])
})
test('parseTime: a bare hour after "at" assumes working hours', () => {
  // "at 5" means 5pm to an agent, not 5am.
  assert.deepEqual(pick(parseTime('at 5')), [17, 0])
  assert.deepEqual(pick(parseTime('at 9')), [9, 0])
  assert.deepEqual(pick(parseTime('at 11')), [11, 0])
})
test('parseTime: does not read a bare number as a time', () => {
  // "3 bed" and "140 sqm" must not become times.
  assert.equal(parseTime('3 bed apartment'), null)
  assert.equal(parseTime('140 sqm'), null)
  assert.equal(parseTime('viewing with Ahmed'), null)
})
test('parseTime: rejects impossible clock values', () => {
  assert.equal(parseTime('25:00'), null)
  assert.equal(parseTime('13pm'), null)
  assert.equal(parseTime('10:75'), null)
})

// ── Days ────────────────────────────────────────────────────────────────────
test('parseDay: today and tomorrow', () => {
  assert.equal(key(parseDay('today', NOW).date), '2026-07-22')
  assert.equal(key(parseDay('tomorrow', NOW).date), '2026-07-23')
  assert.equal(key(parseDay('tmrw', NOW).date), '2026-07-23')
  assert.equal(key(parseDay('day after tomorrow', NOW).date), '2026-07-24')
})
test('parseDay: times of day count as today', () => {
  assert.equal(key(parseDay('tonight', NOW).date), '2026-07-22')
  assert.equal(key(parseDay('this afternoon', NOW).date), '2026-07-22')
})
test('parseDay: a bare weekday means the next one coming', () => {
  // NOW is Wednesday. Friday is in 2 days; Monday is in 5.
  assert.equal(key(parseDay('friday', NOW).date), '2026-07-24')
  assert.equal(key(parseDay('monday', NOW).date), '2026-07-27')
  assert.equal(key(parseDay('sat', NOW).date), '2026-07-25')
})
test('parseDay: the same weekday as today means next week, not today', () => {
  // Saying "wednesday" on a Wednesday means the coming one.
  assert.equal(key(parseDay('wednesday', NOW).date), '2026-07-29')
})
test('parseDay: "next" skips a week', () => {
  assert.equal(key(parseDay('next friday', NOW).date), '2026-07-31')
  assert.equal(key(parseDay('next monday', NOW).date), '2026-08-03')
})
test('parseDay: relative offsets', () => {
  assert.equal(key(parseDay('in 3 days', NOW).date), '2026-07-25')
  assert.equal(key(parseDay('in 2 weeks', NOW).date), '2026-08-05')
})
test('parseDay: numeric dates are day-first', () => {
  // 8/9 is 8 September, not 9 August.
  assert.equal(key(parseDay('8/9', NOW).date), '2026-09-08')
  assert.equal(key(parseDay('25/12/2026', NOW).date), '2026-12-25')
})
test('parseDay: a numeric date already past rolls to next year', () => {
  assert.equal(key(parseDay('5/1', NOW).date), '2027-01-05')
})
test('parseDay: named months, either order', () => {
  assert.equal(key(parseDay('15 August', NOW).date), '2026-08-15')
  assert.equal(key(parseDay('August 15', NOW).date), '2026-08-15')
  assert.equal(key(parseDay('3 sep', NOW).date), '2026-09-03')
})
test('parseDay: a named month already past rolls to next year', () => {
  assert.equal(key(parseDay('10 January', NOW).date), '2027-01-10')
})
test('parseDay: rejects impossible dates', () => {
  assert.equal(parseDay('32/1', NOW), null)
  assert.equal(parseDay('15/13', NOW), null)
})
test('parseDay: returns null when there is no date at all', () => {
  assert.equal(parseDay('viewing with Ahmed', NOW), null)
  assert.equal(parseDay('', NOW), null)
})

// ── Combined ────────────────────────────────────────────────────────────────
test('parseWhen: day and time together', () => {
  const r = parseWhen('viewing tomorrow at 3pm', NOW)
  assert.equal(key(r.start), '2026-07-23')
  assert.equal(hhmm(r.start), '15:00')
  assert.equal(r.allDay, false)
})
test('parseWhen: a day with no time is all-day, not a guessed hour', () => {
  const r = parseWhen('viewing on friday', NOW)
  assert.equal(key(r.start), '2026-07-24')
  assert.equal(r.allDay, true)
})
test('parseWhen: a time with no day means today', () => {
  const r = parseWhen('call at 4pm', NOW)
  assert.equal(key(r.start), '2026-07-22')
  assert.equal(hhmm(r.start), '16:00')
})
test('parseWhen: a time already past today rolls to tomorrow', () => {
  // NOW is 10:00; "at 9am" has gone.
  const r = parseWhen('call at 9am', NOW)
  assert.equal(key(r.start), '2026-07-23')
  assert.equal(hhmm(r.start), '09:00')
})
test('parseWhen: refuses to guess when there is no date or time', () => {
  assert.equal(parseWhen('viewing with Ahmed', NOW), null)
  assert.equal(parseWhen('', NOW), null)
  assert.equal(parseWhen('   ', NOW), null)
})
test('parseWhen: realistic messages', () => {
  const cases = [
    ['viewing with Ahmed tomorrow at 3pm', '2026-07-23', '15:00'],
    ['meeting saturday 10am', '2026-07-25', '10:00'],
    ['call Nour on 8/9 at 11:30', '2026-09-08', '11:30'],
    ['open house next monday', '2026-08-03', null],
  ]
  for (const [text, expectDay, expectTime] of cases) {
    const r = parseWhen(text, NOW)
    assert.ok(r, `should parse: ${text}`)
    assert.equal(key(r.start), expectDay, text)
    if (expectTime) assert.equal(hhmm(r.start), expectTime, text)
    else assert.equal(r.allDay, true, text)
  }
})
test('parseWhen: property details are not mistaken for a time', () => {
  // "3 bed" and "140sqm" must not become 03:00 or a date.
  assert.equal(parseWhen('3 bed 140sqm apartment', NOW), null)
})

// ── Description ─────────────────────────────────────────────────────────────
test('describeWhen: names the day and time', () => {
  const s = describeWhen(parseWhen('tomorrow at 3pm', NOW))
  assert.match(s, /Thursday/)
  assert.match(s, /23 July|July 23/)
})
test('describeWhen: marks an all-day event as such', () => {
  assert.match(describeWhen(parseWhen('friday', NOW)), /all day/i)
})

function pick(t) { return t ? [t.hours, t.minutes] : null }
