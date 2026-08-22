// Tests for plan pricing and the agent-seat cap (src/lib/stripe-plans.ts).
// These are the billing rules, so the caps and the safe default are pinned here.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS, planFor, agentLimitFor, TRIAL_DAYS } from './stripe-plans.ts'

test('the three launch tiers exist at the agreed prices', () => {
  const byId = Object.fromEntries(PLANS.map(p => [p.id, p]))
  assert.equal(byId.team.price, 150)
  assert.equal(byId.business.price, 200)
  assert.equal(byId.unlimited.price, 300)
})

test('agentLimitFor: known plans return their caps', () => {
  assert.equal(agentLimitFor('team'), 5)
  assert.equal(agentLimitFor('business'), 15)
  assert.equal(agentLimitFor('unlimited'), null)   // null = no cap
})

test('agentLimitFor: unknown/missing plan falls back to the SMALLEST cap', () => {
  // A mis-set or empty plan must never accidentally grant unlimited seats.
  for (const id of ['', 'enterprise', 'free', null, undefined]) {
    assert.equal(agentLimitFor(id), 5, `id=${id}`)
  }
})

test('planFor: resolves known ids and returns undefined for unknown', () => {
  assert.equal(planFor('business')?.name, 'Business')
  assert.equal(planFor('nope'), undefined)
  assert.equal(planFor(null), undefined)
})

test('every plan grants full access (tiers differ only by agent count)', () => {
  const featureSets = PLANS.map(p => JSON.stringify(p.features))
  assert.equal(new Set(featureSets).size, 1)   // identical feature lists
})

test('TRIAL_DAYS is one month', () => {
  assert.equal(TRIAL_DAYS, 30)
})
