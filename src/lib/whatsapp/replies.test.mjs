// Unit tests for deterministic reply parsing (src/lib/whatsapp/replies.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseReminderReply, parseSnoozeDays, parseConfirmation, addDays, isExpired,
} from './replies.ts'

// ── reminder replies (the spec's done / snooze 3d / not interested) ─────────
test('parseReminderReply: "remind me to <task>" is NOT a snooze (new reminder)', () => {
  // The real bug: "remind me to call jess in 42 minutes" snoozed the wrong client.
  for (const s of ['remind me to call jess in 42 minutes', 'Remind me to email Sara tomorrow', 'remind me to follow up with Joe']) {
    assert.equal(parseReminderReply(s).action, 'unknown', s)
  }
})
test('parseReminderReply: a plain snooze still works', () => {
  assert.equal(parseReminderReply('snooze 3d').action, 'snooze')
  assert.equal(parseReminderReply('remind me tomorrow').action, 'snooze')
  assert.equal(parseReminderReply('remind me later').action, 'snooze')
})
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
  assert.deepEqual(parseReminderReply('remind me next month'), { action: 'snooze', snoozeDays: 30 })
})

test('parseReminderReply: a command with a date word is NOT a snooze', () => {
  // The real bug: "book a viewing tomorrow at 3pm" was read as "snooze until
  // tomorrow" because it contained a date word while a reminder was open.
  for (const s of [
    'book a viewing tomorrow at 3pm',
    'schedule a call next week',
    'add a meeting tomorrow',
    'set Ahmed\'s budget to 400k',
    'mark property #2 as sold',
    'find me a villa',
    'info on Ahmed',
    'what\'s on tomorrow',
  ]) {
    assert.equal(parseReminderReply(s).action, 'unknown', s)
  }
})

test('parseReminderReply: an explicit snooze word still wins over a command look', () => {
  // "remind me" is unambiguous even if phrased like a request.
  assert.equal(parseReminderReply('remind me tomorrow').action, 'snooze')
  assert.equal(parseReminderReply('snooze until next week').action, 'snooze')
})

test('parseReminderReply: scheduling an event is NOT a snooze', () => {
  // The reported bug: "meeting tomorrow at 4pm" (no leading verb) was read as a
  // snooze and applied to whichever client had an open reminder, inventing a
  // "random name". An event noun + a date word must never snooze.
  for (const s of [
    'meeting tomorrow at 4pm',
    'viewing at 5pm',
    'viewing friday',
    'call Ahmed tomorrow',
    'showing next week',
    'appointment tomorrow',
  ]) {
    assert.equal(parseReminderReply(s).action, 'unknown', s)
  }
})

test('parseReminderReply: an explicit snooze still wins even with an event noun', () => {
  // "remind me about the viewing next week" is genuinely a snooze.
  assert.equal(parseReminderReply('remind me about the viewing next week').action, 'snooze')
  assert.equal(parseReminderReply('snooze the meeting 3d').action, 'snooze')
})

test('parseReminderReply: "done" is not triggered by a command', () => {
  // "delete Ahmed" starts with a command; must not be read as done/complete.
  assert.equal(parseReminderReply('delete that').action, 'unknown')
  // But a genuine completion reply still works.
  assert.equal(parseReminderReply('called them, all good').action, 'done')
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
