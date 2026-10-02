// Tests for plan pricing and the agent-seat cap (src/lib/stripe-plans.ts).
// These are the billing rules, so the caps and the safe default are pinned here.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLANS, planFor, agentLimitFor, TRIAL_DAYS } from './stripe-plans.ts'

test('the four tiers exist at the agreed monthly prices', () => {
  const byId = Object.fromEntries(PLANS.map(p => [p.id, p]))
  assert.deepEqual(PLANS.map(p => p.id), ['team', 'business', 'company', 'unlimited'])
  assert.equal(byId.team.price, 200)
  assert.equal(byId.business.price, 350)
  assert.equal(byId.company.price, 450)
  assert.equal(byId.unlimited.price, null)   // Enterprise: custom, "talk to us"
})

test('Enterprise keeps the internal id "unlimited" so existing customers stay uncapped', () => {
  assert.equal(planFor('unlimited')?.name, 'Enterprise')
  assert.equal(planFor('enterprise'), undefined)   // not an id; only the display name
})

test('only Business is marked popular', () => {
  assert.deepEqual(PLANS.filter(p => p.popular).map(p => p.id), ['business'])
})

test('agentLimitFor: known plans return their caps', () => {
  assert.equal(agentLimitFor('team'), 9)
  assert.equal(agentLimitFor('business'), 29)
  assert.equal(agentLimitFor('company'), 59)
  assert.equal(agentLimitFor('unlimited'), null)   // null = no cap
})

test('the caps and the size labels agree, and rise with the price', () => {
  const sized = PLANS.filter(p => p.agentLimit != null)
  for (const p of sized) assert.ok(p.agents.endsWith(`${p.agentLimit} users`), `${p.id}: "${p.agents}" vs cap ${p.agentLimit}`)
  const caps = sized.map(p => p.agentLimit)
  assert.deepEqual(caps, [...caps].sort((a, b) => a - b))
  const prices = sized.map(p => p.price)
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b))
})

test('agentLimitFor: unknown/missing plan falls back to the SMALLEST cap', () => {
  // A mis-set or empty plan must never accidentally grant unlimited seats.
  for (const id of ['', 'enterprise', 'free', null, undefined]) {
    assert.equal(agentLimitFor(id), 9, `id=${id}`)
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
