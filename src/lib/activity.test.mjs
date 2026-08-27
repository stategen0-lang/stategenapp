// Unit tests for the activity feed's pure logic (src/lib/activity.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listingItem, clientItem, dealMoveItem, mergeActivity, activityLine, activityAgo,
} from './activity.ts'

test('listingItem / clientItem: kind, key, summary', () => {
  const l = listingItem({ id: 12, at: '2026-08-27T10:00:00Z', title: 'Raouché Flat', where: 'Raouché, Beirut', agentCode: 'a1', agentName: 'Lara' })
  assert.equal(l.kind, 'listing_added')
  assert.equal(l.id, 'listing:12')
  assert.equal(l.summary, 'New listing: Raouché Flat')
  assert.equal(l.detail, 'Raouché, Beirut')

  const c = clientItem({ id: 5, at: '2026-08-27T10:00:00Z', name: 'Joe Khoury', where: 'Achrafieh', agentCode: 'a2', agentName: 'Rami' })
  assert.equal(c.kind, 'client_added')
  assert.equal(c.summary, 'New client: Joe Khoury')
  assert.equal(c.detail, 'Looking in Achrafieh')
})

test('dealMoveItem: a plain move reads as "→ Stage"', () => {
  const m = dealMoveItem({ id: 'd1', at: '2026-08-27T10:00:00Z', toStage: 'negotiating', clientName: 'Joe', agentCode: 'a1', agentName: 'Lara' })
  assert.equal(m.kind, 'deal_moved')
  assert.equal(m.summary, 'Joe → Negotiating')
})

test('dealMoveItem: closed + outcome reads as won/lost', () => {
  const won = dealMoveItem({ id: 'd2', at: '2026-08-27T10:00:00Z', toStage: 'closed', outcome: 'won', clientName: 'Maya', agentCode: 'a1', agentName: 'Lara' })
  assert.equal(won.kind, 'deal_won')
  assert.equal(won.summary, 'Deal won: Maya')

  const lost = dealMoveItem({ id: 'd3', at: '2026-08-27T10:00:00Z', toStage: 'closed', outcome: 'lost', clientName: 'Tony', agentCode: 'a1', agentName: 'Lara' })
  assert.equal(lost.kind, 'deal_lost')
  assert.equal(lost.summary, 'Deal lost: Tony')

  // Closed with no recorded outcome is still just a move.
  const closedNoOutcome = dealMoveItem({ id: 'd4', at: '2026-08-27T10:00:00Z', toStage: 'closed', clientName: 'Sara', agentCode: null, agentName: null })
  assert.equal(closedNoOutcome.kind, 'deal_moved')
})

test('mergeActivity: newest first and capped', () => {
  const items = [
    listingItem({ id: 1, at: '2026-08-25T10:00:00Z', title: 'A', agentCode: null, agentName: null }),
    listingItem({ id: 2, at: '2026-08-27T10:00:00Z', title: 'B', agentCode: null, agentName: null }),
    listingItem({ id: 3, at: '2026-08-26T10:00:00Z', title: 'C', agentCode: null, agentName: null }),
  ]
  const merged = mergeActivity(items, 2)
  assert.deepEqual(merged.map(i => i.id), ['listing:2', 'listing:3'])
})

test('activityLine: icon, summary, optional agent, relative age', () => {
  const now = Date.parse('2026-08-27T12:00:00Z')
  const item = dealMoveItem({ id: 'd1', at: '2026-08-27T10:00:00Z', toStage: 'viewing', clientName: 'Joe', agentCode: 'a1', agentName: 'Lara' })
  assert.equal(activityLine(item, { withAgent: true, now }), '📈 Joe → Viewing · Lara · 2h')
  // Without the agent flag, no name is shown.
  assert.equal(activityLine(item, { now }), '📈 Joe → Viewing · 2h')
})

test('activityAgo: buckets', () => {
  const now = Date.parse('2026-08-27T12:00:00Z')
  assert.equal(activityAgo('2026-08-27T11:59:40Z', now), 'just now')
  assert.equal(activityAgo('2026-08-27T11:30:00Z', now), '30m')
  assert.equal(activityAgo('2026-08-27T09:00:00Z', now), '3h')
  assert.equal(activityAgo('2026-08-25T12:00:00Z', now), '2d')
})
