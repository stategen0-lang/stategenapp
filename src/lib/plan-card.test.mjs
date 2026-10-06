// Tests for the wording on the "Your plan" card (src/lib/plan-card.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renewalInfo, seatState } from './plan-card.ts'

const NOW = new Date('2026-10-10T12:00:00Z')

test('renewalInfo: the 2100 placeholder is "no end date", never a renewal date', () => {
  const r = renewalInfo('active', '2100-01-01T00:00:00Z', NOW)
  assert.equal(r.text, 'No end date set')
  assert.equal(r.daysLeft, null)
  assert.equal(renewalInfo('active', null, NOW).text, 'No end date set')
  assert.equal(renewalInfo('active', undefined, NOW).tone, 'muted')
})

test('renewalInfo: an active account shows its paid-through date and days left', () => {
  const r = renewalInfo('active', '2026-11-12T00:00:00Z', NOW)
  assert.equal(r.text, 'Paid through 12 Nov 2026 · 33 days left')
  assert.equal(r.tone, 'ok')
  assert.equal(r.daysLeft, 33)
})

test('renewalInfo: a week or less left is a warning, and one day is singular', () => {
  const soon = renewalInfo('active', '2026-10-16T12:00:00Z', NOW)
  assert.equal(soon.tone, 'warn')
  assert.equal(soon.daysLeft, 6)
  assert.equal(renewalInfo('active', '2026-10-11T12:00:00Z', NOW).text, 'Paid through 11 Oct 2026 · 1 day left')
})

test('renewalInfo: a date already past reads as ended', () => {
  const r = renewalInfo('active', '2026-10-01T00:00:00Z', NOW)
  assert.equal(r.text, 'Ended 1 Oct 2026')
  assert.equal(r.tone, 'bad')
})

test('renewalInfo: the non-active statuses each say what is going on', () => {
  assert.equal(renewalInfo('pending', null, NOW).text, 'Waiting to be activated')
  assert.equal(renewalInfo('expired', '2026-09-01T00:00:00Z', NOW).text, 'Ended 1 Sep 2026')
  assert.equal(renewalInfo('expired', null, NOW).text, 'Subscription ended')
  assert.equal(renewalInfo('suspended', null, NOW).tone, 'bad')
  assert.equal(renewalInfo('weird', null, NOW).text, 'Not active')
  assert.equal(renewalInfo(null, null, NOW).text, 'Not active')
})

test('renewalInfo: a garbage date never throws or shows "Invalid Date"', () => {
  assert.equal(renewalInfo('active', 'not-a-date', NOW).text, 'No end date set')
})

test('seatState: plenty of room', () => {
  const s = seatState(12, 29)
  assert.deepEqual(s, { pct: 41, tone: 'ok', text: '12 of 29 users', note: null })
})

test('seatState: 80% or more warns and says how many are left', () => {
  const s = seatState(8, 9)
  assert.equal(s.tone, 'warn')
  assert.equal(s.note, '1 user left before you reach your limit.')
  assert.equal(seatState(24, 29).note, '5 users left before you reach your limit.')
})

test('seatState: at the limit is a clear "bigger plan" message', () => {
  const s = seatState(9, 9)
  assert.equal(s.tone, 'bad')
  assert.equal(s.pct, 100)
  assert.match(s.note, /at your limit/)
  assert.equal(seatState(11, 9).pct, 100)   // over the cap never overflows the bar
})

test('seatState: Enterprise has no cap, so no bar and no warning', () => {
  const s = seatState(70, null)
  assert.deepEqual(s, { pct: null, tone: 'ok', text: '70 users · no limit', note: null })
  assert.equal(seatState(1, null).text, '1 user · no limit')
})

test('seatState: junk counts are treated as zero', () => {
  assert.equal(seatState(-3, 9).text, '0 of 9 users')
  assert.equal(seatState(NaN, 9).text, '0 of 9 users')
})
