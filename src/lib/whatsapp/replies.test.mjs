// Unit tests for deterministic reply parsing (src/lib/whatsapp/replies.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseReminderReply, parseSnoozeDays, parseConfirmation, addDays, isExpired,
} from './replies.ts'

// ── reminder replies (the spec's done / snooze 3d / not interested) ─────────
test('parseReminderReply: done variants', () => {
  for (const s of ['done', 'Done', 'called', 'called him', 'spoke to them', 'contacted', 'finished']) {
    assert.equal(parseReminderReply(s).action, 'done', s)
  }
})

test('parseReminderReply: not interested variants', () => {
  for (const s of ['not interested', 'Not Interested', 'client is no longer interested', 'dead lead', 'lost']) {
    assert.equal(parseReminderReply(s).action, 'not_interested', s)
  }
})

test('parseReminderReply: "not interested" is not mistaken for "done"', () => {
  // "contacted them, not interested" contains a done-word too
  assert.equal(parseReminderReply('contacted them, not interested').action, 'not_interested')
})

test('parseReminderReply: snooze with an explicit duration', () => {
  assert.deepEqual(parseReminderReply('snooze 3d'), { action: 'snooze', snoozeDays: 3 })
  assert.deepEqual(parseReminderReply('snooze 3 days'), { action: 'snooze', snoozeDays: 3 })
  assert.deepEqual(parseReminderReply('snooze 2w'), { action: 'snooze', snoozeDays: 14 })
  assert.deepEqual(parseReminderReply('postpone 1 month'), { action: 'snooze', snoozeDays: 30 })
})

test('parseReminderReply: bare snooze falls back to 3 days', () => {
  assert.deepEqual(parseReminderReply('snooze'), { action: 'snooze', snoozeDays: 3 })
})

test('parseReminderReply: natural delays without the word snooze', () => {
  assert.deepEqual(parseReminderReply('tomorrow'), { action: 'snooze', snoozeDays: 1 })
  assert.deepEqual(parseReminderReply('next week'), { action: 'snooze', snoozeDays: 7 })
})

test('parseReminderReply: anything else is unknown (defer to Grok)', () => {
  assert.equal(parseReminderReply('he wants a bigger place in Achrafieh').action, 'unknown')
  assert.equal(parseReminderReply('').action, 'unknown')
  assert.equal(parseReminderReply(null).action, 'unknown')
})

// ── duration parsing ────────────────────────────────────────────────────────
test('parseSnoozeDays: units and absent durations', () => {
  assert.equal(parseSnoozeDays('5d'), 5)
  assert.equal(parseSnoozeDays('2 weeks'), 14)
  assert.equal(parseSnoozeDays('3 months'), 90)
  assert.equal(parseSnoozeDays('no duration here'), null)
  assert.equal(parseSnoozeDays('0 days'), null) // zero is not a delay
})

// ── confirmation of pending writes ──────────────────────────────────────────
test('parseConfirmation: approvals', () => {
  for (const s of ['yes', 'Y', 'yep', 'ok', 'confirm', 'go ahead', 'do it']) {
    assert.equal(parseConfirmation(s), 'confirm', s)
  }
})

test('parseConfirmation: rejections', () => {
  for (const s of ['no', 'cancel', 'stop', 'nevermind', 'discard']) {
    assert.equal(parseConfirmation(s), 'cancel', s)
  }
})

test('parseConfirmation: ambiguous text is unknown, never assumed to be yes', () => {
  assert.equal(parseConfirmation('maybe later'), 'unknown')
  assert.equal(parseConfirmation('what does that mean?'), 'unknown')
  assert.equal(parseConfirmation(''), 'unknown')
})

// ── scheduling ──────────────────────────────────────────────────────────────
test('addDays: returns an ISO date, crossing month boundaries', () => {
  assert.equal(addDays(new Date('2026-07-30T00:00:00Z'), 3), '2026-08-02')
  assert.equal(addDays(new Date('2026-12-31T00:00:00Z'), 1), '2027-01-01')
  assert.equal(addDays(new Date('2026-07-01T00:00:00Z'), 0), '2026-07-01')
})

// ── pending action expiry (spec: 10 minutes) ───────────────────────────────
test('isExpired: before, after, and missing expiry', () => {
  const now = new Date('2026-07-20T12:00:00Z')
  assert.equal(isExpired('2026-07-20T12:05:00Z', now), false) // 5 min left
  assert.equal(isExpired('2026-07-20T11:55:00Z', now), true)  // 5 min ago
  assert.equal(isExpired('2026-07-20T12:00:00Z', now), true)  // exactly now
  assert.equal(isExpired(null, now), true)                    // nothing pending
  assert.equal(isExpired('rubbish', now), true)               // unparseable → treat as expired
})
