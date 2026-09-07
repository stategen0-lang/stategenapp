// Tests for the manual-billing access gate (src/lib/billing.ts). This decides
// whether a company can use the app at all, so its edges are launch-critical.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { companyHasAccess, accessMessage, DEFAULT_PERIOD_DAYS } from './billing.ts'

const NOW = new Date('2026-08-22T12:00:00Z')
const FUTURE = '2026-09-22'
const PAST = '2026-07-22'

test('companyHasAccess: active with a future end date → true', () => {
  assert.equal(companyHasAccess('active', FUTURE, NOW), true)
})

test('companyHasAccess: active with no end date → true (open-ended)', () => {
  assert.equal(companyHasAccess('active', null, NOW), true)
  assert.equal(companyHasAccess('active', undefined, NOW), true)
})

test('companyHasAccess: active but past the end date → false', () => {
  assert.equal(companyHasAccess('active', PAST, NOW), false)
})

test('companyHasAccess: non-active statuses never have access', () => {
  for (const s of ['pending', 'expired', 'suspended', '', null, undefined, 'ACTIVE']) {
    assert.equal(companyHasAccess(s, FUTURE, NOW), false, `status=${s}`)
  }
})

test('companyHasAccess: the end date is exclusive (expires the instant it passes)', () => {
  const until = '2026-08-22T12:00:00Z'
  assert.equal(companyHasAccess('active', until, new Date('2026-08-22T11:59:59Z')), true)
  assert.equal(companyHasAccess('active', until, new Date('2026-08-22T12:00:01Z')), false)
})

test('accessMessage: each status has a distinct, non-empty message', () => {
  const msgs = ['pending', 'expired', 'suspended', 'anything-else'].map(accessMessage)
  for (const m of msgs) assert.ok(m && m.length > 0)
  assert.equal(new Set(msgs).size, 4)   // all distinct
})

test('DEFAULT_PERIOD_DAYS is one month', () => {
  assert.equal(DEFAULT_PERIOD_DAYS, 30)
})
