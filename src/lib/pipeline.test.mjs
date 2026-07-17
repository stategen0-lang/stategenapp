// Unit tests for the deal pipeline helpers (src/lib/pipeline.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isStage, STAGE_IDS, daysInStage, staleFlag,
  dealsInStage, totalValue, sortForBoard,
} from './pipeline.ts'

const deal = (o = {}) => ({
  id: o.id ?? 'd1', company_id: 1, client_id: 1, agent_id: 'a1', property_id: null,
  stage: 'lead', outcome: null, value: 0, stage_changed_at: null,
  created_at: '2026-07-01T00:00:00Z', clientName: 'Test', propertyLabel: null,
  ...o,
})

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

// ── stages ──────────────────────────────────────────────────────────────────
test('STAGE_IDS: the five spec stages in order', () => {
  assert.deepEqual(STAGE_IDS, ['lead', 'contacted', 'viewing', 'negotiating', 'closed'])
})
test('isStage: accepts valid stages, rejects anything else', () => {
  assert.equal(isStage('lead'), true)
  assert.equal(isStage('closed'), true)
  assert.equal(isStage('archived'), false)
  assert.equal(isStage(''), false)
  assert.equal(isStage(null), false)
})

// ── daysInStage ─────────────────────────────────────────────────────────────
test('daysInStage: null/invalid → 0', () => {
  assert.equal(daysInStage(null), 0)
  assert.equal(daysInStage('not-a-date'), 0)
})
test('daysInStage: counts whole days since the stage changed', () => {
  assert.equal(daysInStage(daysAgo(0)), 0)
  assert.equal(daysInStage(daysAgo(10)), 10)
})
test('daysInStage: future timestamp never goes negative', () => {
  assert.equal(daysInStage(daysAgo(-5)), 0)
})

// ── staleFlag (amber over 7 days, red over 14 — per spec) ───────────────────
test('staleFlag: ok / warn / late boundaries', () => {
  assert.equal(staleFlag(0), 'ok')
  assert.equal(staleFlag(7), 'ok')
  assert.equal(staleFlag(8), 'warn')
  assert.equal(staleFlag(14), 'warn')
  assert.equal(staleFlag(15), 'late')
})

// ── column aggregates ───────────────────────────────────────────────────────
test('dealsInStage: filters to one stage', () => {
  const ds = [deal({ id: 'a', stage: 'lead' }), deal({ id: 'b', stage: 'viewing' }), deal({ id: 'c', stage: 'lead' })]
  assert.deepEqual(dealsInStage(ds, 'lead').map(d => d.id), ['a', 'c'])
  assert.deepEqual(dealsInStage(ds, 'closed'), [])
})
test('totalValue: sums deal values, tolerating junk', () => {
  assert.equal(totalValue([deal({ value: 100 }), deal({ value: 250 })]), 350)
  assert.equal(totalValue([]), 0)
  assert.equal(totalValue([deal({ value: null }), deal({ value: 50 })]), 50)
})
test('sortForBoard: highest value first, without mutating the input', () => {
  const ds = [deal({ id: 'low', value: 10 }), deal({ id: 'high', value: 900 }), deal({ id: 'mid', value: 300 })]
  const sorted = sortForBoard(ds)
  assert.deepEqual(sorted.map(d => d.id), ['high', 'mid', 'low'])
  assert.deepEqual(ds.map(d => d.id), ['low', 'high', 'mid']) // original untouched
})
