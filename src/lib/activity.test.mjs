// Unit tests for the activity feed's pure logic (src/lib/activity.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listingItem, clientItem, dealMoveItem, offerItem, eventItem, referralItem, mergeActivity, activityLine, activityAgo,
  summarizeByAgent, activityHref, filterActivity, kindsPresent, agentsPresent,
  digestActivity, activityByDay, priceChangeItem, statusChangeItem,
} from './activity.ts'

test('offerItem / eventItem: kind, key, summary', () => {
  const o = offerItem({ id: '9', at: '2026-09-01T10:00:00Z', amount: 480000, side: 'buyer', clientName: 'Joe', agentCode: 'a2', agentName: 'Rami' })
  assert.equal(o.kind, 'offer_logged')
  assert.equal(o.id, 'offer:9')
  assert.match(o.summary, /Offer logged: \$480K/)
  assert.match(o.detail, /on Joe/)
  const c = offerItem({ id: '10', at: '2026-09-01T10:00:00Z', amount: 500000, side: 'owner', clientName: 'Joe', agentCode: 'a2', agentName: 'Rami' })
  assert.match(c.summary, /Counter logged/)

  const e = eventItem({ id: '3', at: '2026-09-01T10:00:00Z', eventKind: 'viewing', title: 'Achrafieh flat', agentCode: 'a2', agentName: 'Rami' })
  assert.equal(e.kind, 'event_scheduled')
  assert.match(e.summary, /Scheduled viewing: Achrafieh flat/)
})

test('referralItem: attributed to the referring agent, names the receiver', () => {
  const r = referralItem({
    id: 12, at: '2026-09-10T09:00:00Z', clientName: 'Jess Khoury', toName: 'Nadia Haddad',
    agentCode: 'a2', agentName: 'Rami',
  })
  assert.equal(r.kind, 'client_referred')
  assert.equal(r.id, 'referral:12')
  assert.equal(r.agentCode, 'a2')            // the referrer keeps the credit
  assert.equal(r.summary, 'Referred Jess Khoury to Nadia Haddad')
})

test('referralItem: omits the receiver when unknown', () => {
  const r = referralItem({ id: 3, at: '2026-09-10T09:00:00Z', clientName: 'Joe', agentCode: 'a1', agentName: 'Lara' })
  assert.equal(r.summary, 'Referred Joe')
})
test('summarizeByAgent: counts per kind, busiest first', () => {
  const items = [
    listingItem({ id: 1, at: '2026-09-01T10:00:00Z', title: 'A', agentCode: 'a1', agentName: 'Lara' }),
    listingItem({ id: 2, at: '2026-09-01T11:00:00Z', title: 'B', agentCode: 'a1', agentName: 'Lara' }),
    clientItem({ id: 3, at: '2026-09-01T12:00:00Z', name: 'C', agentCode: 'a1', agentName: 'Lara' }),
    clientItem({ id: 4, at: '2026-09-01T12:00:00Z', name: 'D', agentCode: 'a2', agentName: 'Rami' }),
  ]
  const rows = summarizeByAgent(items)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].agentName, 'Lara')     // 3 actions → first
  assert.equal(rows[0].total, 3)
  assert.equal(rows[0].counts.listing_added, 2)
  assert.equal(rows[0].counts.client_added, 1)
  assert.equal(rows[1].agentName, 'Rami')
  assert.equal(rows[1].total, 1)
})

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

// ── Filtering, links, and the week at a glance ──────────────────────────────

const at = (daysAgo, h = 0) => new Date(Date.UTC(2026, 8, 20 - daysAgo, 12 + h)).toISOString()
const NOW = Date.UTC(2026, 8, 20, 18)

const feed = [
  listingItem({ id: 5, at: at(0), title: 'Achrafieh flat', where: 'Achrafieh', agentCode: 'NH', agentName: 'Nour' }),
  clientItem({ id: 9, at: at(0, 1), name: 'Rita Aoun', where: 'Hamra', agentCode: 'LK', agentName: 'Lara' }),
  priceChangeItem({ id: 1, propertyId: 5, at: at(1), title: 'Achrafieh flat', from: 500000, to: 450000, agentCode: 'NH', agentName: 'Nour' }),
  statusChangeItem({ id: 2, propertyId: 7, at: at(2), title: 'Kaslik villa', from: 'Available', to: 'Sold', agentCode: 'LK', agentName: 'Lara' }),
  listingItem({ id: 6, at: at(10), title: 'Old listing', where: 'Tripoli', agentCode: 'NH', agentName: 'Nour' }),
]

test('priceChangeItem: a drop reads as a drop, with the percentage', () => {
  const [item] = [feed[2]]
  assert.equal(item.kind, 'price_changed')
  assert.match(item.summary, /^Price drop/)
  assert.match(item.detail, /\$500K → \$450K/)
  assert.match(item.detail, /−10%/)
  assert.deepEqual(item.target, { type: 'property', id: 5 })

  const up = priceChangeItem({ id: 3, propertyId: 1, at: at(0), title: 'x', from: 400000, to: 500000, agentCode: null, agentName: null })
  assert.match(up.summary, /^Price up/)
  assert.match(up.detail, /\+25%/)

  const rent = priceChangeItem({ id: 4, propertyId: 1, at: at(0), title: 'x', from: 1000, to: 900, rent: true, agentCode: null, agentName: null })
  assert.match(rent.detail, /\/mo/)
})

test('statusChangeItem: says what it became and what it was', () => {
  const item = feed[3]
  assert.equal(item.summary, 'Sold: Kaslik villa')
  assert.equal(item.detail, 'was Available')
  assert.deepEqual(item.target, { type: 'property', id: 7 })
})

test('activityHref: every row leads somewhere sensible', () => {
  assert.equal(activityHref({ type: 'property', id: 5 }), '/properties?open=5')
  assert.equal(activityHref({ type: 'client', id: 9 }), '/clients?open=9')
  assert.equal(activityHref({ type: 'calendar' }), '/calendar')
  assert.equal(activityHref(null), null)
  assert.equal(activityHref(undefined), null)
  // An id we never resolved is not a link to nowhere.
  assert.equal(activityHref({ type: 'property' }), null)
})

test('filterActivity: by kind, agent, period and text', () => {
  assert.equal(filterActivity(feed, { kinds: ['price_changed'] }).length, 1)
  assert.equal(filterActivity(feed, { kinds: ['price_changed', 'status_changed'] }).length, 2)
  assert.equal(filterActivity(feed, { agentCode: 'NH' }).length, 3)
  assert.equal(filterActivity(feed, { from: at(3) }).length, 4)
  assert.equal(filterActivity(feed, { query: 'achrafieh' }).length, 2)   // summary and detail
  assert.equal(filterActivity(feed, { query: 'nour' }).length, 3)        // agent name
  assert.equal(filterActivity(feed, { query: 'ACHRAFIEH' }).length, 2)   // case-insensitive
  // Filters stack.
  assert.equal(filterActivity(feed, { agentCode: 'NH', kinds: ['listing_added'], from: at(3) }).length, 1)
  // No filter is not a filter.
  assert.equal(filterActivity(feed, {}).length, feed.length)
  assert.equal(filterActivity(feed, { kinds: [], query: '  ' }).length, feed.length)
})

test('kindsPresent / agentsPresent: only what is actually there', () => {
  assert.deepEqual(kindsPresent(feed), ['listing_added', 'client_added', 'price_changed', 'status_changed'])
  assert.deepEqual(agentsPresent(feed), [{ code: 'LK', name: 'Lara' }, { code: 'NH', name: 'Nour' }])
  assert.deepEqual(kindsPresent([]), [])
})

test('digestActivity: this week against the one before', () => {
  const d = digestActivity(feed, 7, NOW)
  assert.equal(d.total, 4)                 // the 10-day-old one is outside
  assert.equal(d.counts.price_changed, 1)
  assert.equal(d.counts.listing_added, 1)
  assert.equal(d.previousTotal, 1)
  assert.equal(d.changePct, 300)
  // No earlier window means no arrow — "+100%" off nothing says nothing.
  assert.equal(digestActivity(feed.slice(0, 2), 7, NOW).changePct, null)
})

test('activityByDay: one bucket per day, oldest first, zeros kept', () => {
  const days = activityByDay(feed, 14, NOW)
  assert.equal(days.length, 14)
  assert.equal(days[13].count, 2)          // today
  assert.equal(days[12].count, 1)          // yesterday
  assert.ok(days.some(d => d.count === 0), 'quiet days must still be drawn')
  assert.ok(days[0].date < days[13].date, 'oldest first')
})
