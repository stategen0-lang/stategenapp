// Unit tests for follow-up reminder logic (src/lib/whatsapp/reminders.ts).
// Covers who gets chased, what the message says, and what a reply changes.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  daysSince, lastContactAt, isDue, reminderText, reminderOutcome,
  STALE_AFTER_DAYS,
} from './reminders.ts'

const NOW = new Date('2026-07-21T09:00:00Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const client = (o = {}) => ({
  id: 1, name: 'Ahmed Khoury', status: 'Searching', budget: 400_000,
  propertyType: 'Appartement', location: 'Hamra',
  lastContactAt: daysAgo(7), createdAt: daysAgo(30),
  ...o,
})

// ── daysSince ───────────────────────────────────────────────────────────────
test('daysSince: whole days elapsed', () => {
  assert.equal(daysSince(daysAgo(5), NOW), 5)
  assert.equal(daysSince(daysAgo(0), NOW), 0)
})
test('daysSince: missing or unparseable dates are infinitely stale', () => {
  assert.equal(daysSince(null, NOW), Infinity)
  assert.equal(daysSince('not a date', NOW), Infinity)
})

// ── lastContactAt ───────────────────────────────────────────────────────────
test('lastContactAt: uses the newest log entry', () => {
  const notes = JSON.stringify({ log: [
    { at: '2026-07-10T00:00:00Z', note: 'newer' },
    { at: '2026-07-01T00:00:00Z', note: 'older' },
  ] })
  assert.equal(lastContactAt(notes, '2026-01-01T00:00:00Z'), '2026-07-10T00:00:00Z')
})
test('lastContactAt: takes the max, not just the first entry', () => {
  const notes = JSON.stringify({ log: [
    { at: '2026-07-01T00:00:00Z', note: 'older first' },
    { at: '2026-07-15T00:00:00Z', note: 'newest last' },
  ] })
  assert.equal(lastContactAt(notes, '2026-01-01T00:00:00Z'), '2026-07-15T00:00:00Z')
})
test('lastContactAt: falls back to created_at when there is no log', () => {
  assert.equal(lastContactAt('{}', '2026-05-05T00:00:00Z'), '2026-05-05T00:00:00Z')
  assert.equal(lastContactAt(null, '2026-05-05T00:00:00Z'), '2026-05-05T00:00:00Z')
  assert.equal(lastContactAt('{corrupt', '2026-05-05T00:00:00Z'), '2026-05-05T00:00:00Z')
})
test('lastContactAt: ignores log entries with no timestamp', () => {
  const notes = JSON.stringify({ log: [{ note: 'no date' }] })
  assert.equal(lastContactAt(notes, '2026-05-05T00:00:00Z'), '2026-05-05T00:00:00Z')
})

// ── isDue ───────────────────────────────────────────────────────────────────
test('isDue: quiet for longer than the threshold', () => {
  assert.equal(isDue(client({ lastContactAt: daysAgo(STALE_AFTER_DAYS) }), NOW), true)
  assert.equal(isDue(client({ lastContactAt: daysAgo(30) }), NOW), true)
})
test('isDue: recently contacted clients are left alone', () => {
  assert.equal(isDue(client({ lastContactAt: daysAgo(1) }), NOW), false)
  assert.equal(isDue(client({ lastContactAt: daysAgo(STALE_AFTER_DAYS - 1) }), NOW), false)
})
test('isDue: closed and inactive clients are never chased', () => {
  assert.equal(isDue(client({ status: 'Closed', lastContactAt: daysAgo(90) }), NOW), false)
  assert.equal(isDue(client({ status: 'Inactive', lastContactAt: daysAgo(90) }), NOW), false)
})
test('isDue: a brand-new client with no contact is not instantly stale', () => {
  const fresh = client({ lastContactAt: null, createdAt: daysAgo(0) })
  assert.equal(isDue(fresh, NOW), false)
})
test('isDue: a never-contacted old client is due', () => {
  assert.equal(isDue(client({ lastContactAt: null, createdAt: daysAgo(20) }), NOW), true)
})

// ── reminderText ────────────────────────────────────────────────────────────
test('reminderText: follows the spec wording', () => {
  const t = reminderText(client({ lastContactAt: daysAgo(5) }), NOW)
  assert.match(t, /Reminder: Call Ahmed Khoury today\./)
  assert.match(t, /Last contact: 5 days ago\./)
  assert.match(t, /Interest: Appartement · \$400,000 · Hamra\./)
  assert.match(t, /Reply: done, snooze 3d, or not interested/)
})
test('reminderText: singular and same-day phrasing', () => {
  assert.match(reminderText(client({ lastContactAt: daysAgo(1) }), NOW), /Last contact: 1 day ago\./)
  assert.match(reminderText(client({ lastContactAt: daysAgo(0) }), NOW), /Last contact: today\./)
})
test('reminderText: omits the interest line when nothing is known', () => {
  const t = reminderText(client({ budget: 0, propertyType: '', location: '' }), NOW)
  assert.equal(/Interest:/.test(t), false)
  assert.match(t, /Reply: done/)
})

// ── reminderOutcome ─────────────────────────────────────────────────────────
test('reminderOutcome: done marks the reminder complete and logs the call', () => {
  const o = reminderOutcome('done', 'Ahmed', 3, NOW)
  assert.equal(o.status, 'done')
  assert.equal(o.clientStatus, undefined)     // "called" does not change their stage
  assert.match(o.logEntry, /Called/)
  assert.match(o.reply, /Ahmed/)
})
test('reminderOutcome: snooze pushes the due date out', () => {
  const o = reminderOutcome('snooze', 'Ahmed', 3, NOW)
  assert.equal(o.status, 'snoozed')
  assert.equal(o.dueDate, '2026-07-24')
  assert.match(o.reply, /2026-07-24/)
})
test('reminderOutcome: snooze honours a longer delay', () => {
  assert.equal(reminderOutcome('snooze', 'Ahmed', 14, NOW).dueDate, '2026-08-04')
})
test('reminderOutcome: not interested deactivates the client', () => {
  const o = reminderOutcome('not_interested', 'Ahmed', 3, NOW)
  assert.equal(o.status, 'not_interested')
  assert.equal(o.clientStatus, 'Inactive')
  assert.match(o.reply, /inactive/i)
})
test('reminderOutcome: an unrecognised reply produces nothing to apply', () => {
  assert.equal(reminderOutcome('unknown', 'Ahmed', 3, NOW), null)
})
