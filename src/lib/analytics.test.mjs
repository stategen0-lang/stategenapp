// Unit tests for analytics computed from pipeline deals (src/lib/analytics.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  summarise, funnel, leaderboard, monthlyClosed, monthOverMonth,
  avgDaysToClose, STAGES,
  dealCommission, rankOf, inventoryStats, clientStats, offerStats,
} from './analytics.ts'

const deal = (o = {}) => ({
  id: o.id ?? 'd', agent_id: o.agent_id ?? 'a1',
  stage: o.stage ?? 'lead', outcome: o.outcome ?? null, value: o.value ?? 0,
  created_at: o.created_at ?? '2026-07-01T00:00:00Z',
  stage_changed_at: o.stage_changed_at ?? null,
})

// ── summarise ─────────────────────────────────────────────────────────────
test('summarise: counts open/closed/won/lost and values', () => {
  const s = summarise([
    deal({ stage: 'lead', value: 100 }),
    deal({ stage: 'viewing', value: 200 }),
    deal({ stage: 'closed', outcome: 'won', value: 500 }),
    deal({ stage: 'closed', outcome: 'lost', value: 300 }),
  ])
  assert.equal(s.total, 4)
  assert.equal(s.open, 2)
  assert.equal(s.closed, 2)
  assert.equal(s.won, 1)
  assert.equal(s.lost, 1)
  assert.equal(s.openValue, 300)   // 100 + 200
  assert.equal(s.wonValue, 500)
})
test('summarise: win rate is won over decided, null when nothing decided', () => {
  assert.equal(summarise([deal({ outcome: 'won' }), deal({ outcome: 'won' }), deal({ outcome: 'lost' })]).winRate, 67)
  assert.equal(summarise([deal(), deal()]).winRate, null)   // all open
})
test('summarise: average won value', () => {
  const s = summarise([deal({ outcome: 'won', value: 100 }), deal({ outcome: 'won', value: 300 })])
  assert.equal(s.avgWonValue, 200)
})
test('summarise: tolerates junk values', () => {
  const s = summarise([deal({ stage: 'lead', value: null }), deal({ stage: 'lead', value: 'x' }), deal({ stage: 'lead', value: 50 })])
  assert.equal(s.openValue, 50)
})
test('summarise: empty input is all zeros, win rate null', () => {
  const s = summarise([])
  assert.equal(s.total, 0)
  assert.equal(s.winRate, null)
  assert.equal(s.avgWonValue, 0)
})

// ── funnel ────────────────────────────────────────────────────────────────
test('funnel: one entry per stage, in order', () => {
  const f = funnel([])
  assert.deepEqual(f.map(s => s.id), STAGES.map(s => s.id))
})
test('funnel: counts and value per stage', () => {
  const f = funnel([
    deal({ stage: 'lead', value: 100 }),
    deal({ stage: 'lead', value: 200 }),
    deal({ stage: 'viewing', value: 500 }),
    deal({ stage: 'closed', value: 900, outcome: 'won' }),
  ])
  const lead = f.find(s => s.id === 'lead')
  assert.equal(lead.count, 2)
  assert.equal(lead.value, 300)
  assert.equal(lead.pct, 50)        // 2 of 4
  assert.equal(f.find(s => s.id === 'viewing').count, 1)
})
test('funnel: no divide-by-zero on empty input', () => {
  assert.equal(funnel([]).every(s => s.count === 0 && s.pct === 0), true)
})

// ── leaderboard ───────────────────────────────────────────────────────────
test('leaderboard: aggregates per agent, best closer first', () => {
  const agents = [{ id: 'a1', name: 'Lara' }, { id: 'a2', name: 'Rami' }]
  const lb = leaderboard([
    deal({ agent_id: 'a1', stage: 'closed', outcome: 'won', value: 500 }),
    deal({ agent_id: 'a2', stage: 'closed', outcome: 'won', value: 900 }),
    deal({ agent_id: 'a1', stage: 'lead', value: 100 }),
  ], agents)
  assert.equal(lb[0].id, 'a2')      // higher won value ranks first
  assert.equal(lb[0].wonValue, 900)
  assert.equal(lb[1].id, 'a1')
  assert.equal(lb[1].won, 1)
  assert.equal(lb[1].open, 1)
})
test('leaderboard: open pipeline breaks a no-close tie', () => {
  const agents = [{ id: 'a1', name: 'Lara' }, { id: 'a2', name: 'Rami' }]
  const lb = leaderboard([
    deal({ agent_id: 'a1', stage: 'lead', value: 100 }),
    deal({ agent_id: 'a2', stage: 'viewing', value: 900 }),
  ], agents)
  assert.equal(lb[0].id, 'a2')      // no wins either side; more open value wins
})
test('leaderboard: an agent with no deals still appears with zeros', () => {
  const lb = leaderboard([], [{ id: 'a1', name: 'Lara' }])
  assert.equal(lb[0].total, 0)
  assert.equal(lb[0].winRate, null)
})

// ── monthly trend ─────────────────────────────────────────────────────────
const NOW = new Date(2026, 6, 15)   // 15 July 2026

test('monthlyClosed: last N months, oldest first', () => {
  const pts = monthlyClosed([], NOW, 6)
  assert.equal(pts.length, 6)
  assert.equal(pts[5].key, '2026-07')
  assert.equal(pts[0].key, '2026-02')
})
test('monthlyClosed: counts won deals in the month they closed', () => {
  const pts = monthlyClosed([
    deal({ outcome: 'won', value: 500, stage_changed_at: '2026-07-10T00:00:00Z' }),
    deal({ outcome: 'won', value: 300, stage_changed_at: '2026-06-20T00:00:00Z' }),
    deal({ outcome: 'lost', value: 999, stage_changed_at: '2026-07-10T00:00:00Z' }),  // ignored
  ], NOW, 6)
  const jul = pts.find(p => p.key === '2026-07')
  const jun = pts.find(p => p.key === '2026-06')
  assert.equal(jul.wonCount, 1)
  assert.equal(jul.wonValue, 500)
  assert.equal(jun.wonValue, 300)
})
test('monthlyClosed: a win outside the window is not counted', () => {
  const pts = monthlyClosed([deal({ outcome: 'won', value: 500, stage_changed_at: '2025-01-01T00:00:00Z' })], NOW, 6)
  assert.equal(pts.reduce((s, p) => s + p.wonCount, 0), 0)
})

test('monthOverMonth: this vs last month wins', () => {
  const m = monthOverMonth([
    deal({ outcome: 'won', value: 500, stage_changed_at: '2026-07-05T00:00:00Z' }),
    deal({ outcome: 'won', value: 200, stage_changed_at: '2026-06-05T00:00:00Z' }),
    deal({ outcome: 'won', value: 100, stage_changed_at: '2026-06-25T00:00:00Z' }),
  ], NOW)
  assert.equal(m.wonThis, 1)
  assert.equal(m.wonLast, 2)
  assert.equal(m.valueThis, 500)
  assert.equal(m.valueLast, 300)
})

// ── avg days to close ─────────────────────────────────────────────────────
test('avgDaysToClose: average creation-to-won span', () => {
  const d = avgDaysToClose([
    deal({ outcome: 'won', created_at: '2026-07-01T00:00:00Z', stage_changed_at: '2026-07-11T00:00:00Z' }), // 10d
    deal({ outcome: 'won', created_at: '2026-07-01T00:00:00Z', stage_changed_at: '2026-07-21T00:00:00Z' }), // 20d
  ])
  assert.equal(d, 15)
})
test('avgDaysToClose: null when nothing is won', () => {
  assert.equal(avgDaysToClose([deal({ stage: 'lead' })]), null)
})
test('avgDaysToClose: ignores a negative or unparseable span', () => {
  const d = avgDaysToClose([
    deal({ outcome: 'won', created_at: '2026-07-20T00:00:00Z', stage_changed_at: '2026-07-01T00:00:00Z' }), // negative, ignored
    deal({ outcome: 'won', created_at: '2026-07-01T00:00:00Z', stage_changed_at: '2026-07-06T00:00:00Z' }), // 5d
  ])
  assert.equal(d, 5)
})

// ── commission ────────────────────────────────────────────────────────────
test('dealCommission: 2.5% agent + 2.5% company on won deals only', () => {
  assert.deepEqual(dealCommission(deal({ outcome: 'won', value: 400000 })), { agent: 10000, company: 10000, total: 20000 })
  assert.deepEqual(dealCommission(deal({ outcome: 'lost', value: 400000 })), { agent: 0, company: 0, total: 0 })
  assert.deepEqual(dealCommission(deal({ stage: 'lead', value: 400000 })), { agent: 0, company: 0, total: 0 })
})
test('dealCommission: respects a per-deal override (co-broker split)', () => {
  const c = dealCommission({ ...deal({ outcome: 'won', value: 400000 }), agentCommissionPct: 1.25, companyCommissionPct: 1.25 })
  assert.deepEqual(c, { agent: 5000, company: 5000, total: 10000 })
})
test('summarise: rolls commission + close rate', () => {
  const s = summarise([deal({ outcome: 'won', value: 400000 }), deal({ outcome: 'won', value: 200000 }), deal({ stage: 'lead' })])
  assert.equal(s.agentCommission, 15000)      // 2.5% of 600k
  assert.equal(s.companyCommission, 15000)
  assert.equal(s.totalCommission, 30000)
  assert.equal(s.closeRate, 67)               // 2 won of 3 total
})

// ── rankOf (private self-rank) ──────────────────────────────────────────────
test('rankOf: 1-based rank + team size by a metric', () => {
  const agents = [{ id: 'a1', name: 'A' }, { id: 'a2', name: 'B' }, { id: 'a3', name: 'C' }]
  const deals = [
    deal({ agent_id: 'a1', outcome: 'won', value: 100 }),
    deal({ agent_id: 'a2', outcome: 'won', value: 500 }),
    deal({ agent_id: 'a3', outcome: 'won', value: 300 }),
  ]
  assert.deepEqual(rankOf(deals, agents, 'a2', 'wonValue'), { rank: 1, of: 3 })
  assert.deepEqual(rankOf(deals, agents, 'a1', 'wonValue'), { rank: 3, of: 3 })
  assert.equal(rankOf(deals, agents, 'nope', 'wonValue'), null)
})

// ── inventory / clients / offers ────────────────────────────────────────────
test('inventoryStats: counts, value, status mix', () => {
  const inv = inventoryStats([
    { type: 'Villa', transaction: 'For Sale', status: 'Available', price: 500000, rent: 0 },
    { type: 'Villa', transaction: 'For Sale', status: 'Sold', price: 300000, rent: 0 },
    { type: 'Office', transaction: 'For Rent', status: 'Available', price: 0, rent: 2000 },
  ])
  assert.equal(inv.total, 3)
  assert.equal(inv.totalValue, 800000)
  assert.equal(inv.available, 2)
  assert.equal(inv.sold, 1)
  assert.equal(inv.forSale, 2)
  assert.equal(inv.forRent, 1)
  assert.equal(inv.byType[0].type, 'Villa')
})
test('clientStats: buyer/renter + hot/warm/cold buckets', () => {
  const cs = clientStats([
    { type: 'Buyer', leadScore: 80 }, { type: 'Renter', leadScore: 50 }, { type: 'Buyer', leadScore: 20 },
  ])
  assert.equal(cs.buyers, 2); assert.equal(cs.renters, 1)
  assert.equal(cs.hot, 1); assert.equal(cs.warm, 1); assert.equal(cs.cold, 1)
})
test('offerStats: win-rate + avg discount vs asking', () => {
  const o = offerStats([
    { status: 'accepted', amount: 465000, asking: 480000 },
    { status: 'rejected', amount: 400000, asking: 480000 },
    { status: 'open', amount: 470000, asking: 480000 },
  ])
  assert.equal(o.accepted, 1); assert.equal(o.rejected, 1); assert.equal(o.open, 1)
  assert.equal(o.winRate, 50)
  assert.equal(o.avgAcceptedDiscount, 3)   // 15k below 480k ≈ 3%
})
