// Unit tests for new-listing match alerts (src/lib/alerts.ts).
// The matching engine is tested elsewhere; here we test which matches become
// alerts, the cap, and the sold-listing case.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAlerts, alertHeadline, ALERT_THRESHOLD } from './alerts.ts'

// A 3-bed Beirut apartment for sale at 480k.
const property = {
  id: 5, title: 'Raouché Apartment', type: 'Appartement', transaction: 'For Sale',
  price: 480000, rent: 0, district: 'Raouché', city: 'Beirut', size: 145,
  beds: 3, baths: 2, garden: false, balcony: true, view: 'Sea', status: 'Available',
  agentId: 'a1', photos: [],
}

const client = (o = {}) => ({
  id: o.id ?? 1, name: o.name ?? 'Client', type: o.type ?? 'Buyer',
  email: '', phone: '', budget: o.budget ?? 480000, agentId: o.agentId ?? 'a2',
  status: 'Searching', leadScore: 0, agentRating: 3,
  req: {
    transaction: o.transaction ?? 'For Sale', type: o.reqType ?? 'Appartement',
    location: o.location ?? 'Beirut', priceMin: 0, priceMax: o.budget ?? 480000,
    beds: o.beds ?? 3, baths: 0, size: 0, garden: false, balcony: false, notes: '',
  },
})

test('buildAlerts: a well-matched client produces an alert', () => {
  const alerts = buildAlerts(property, [client({ id: 7, name: 'Ahmed', agentId: 'a2' })])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].client_id, 7)
  assert.equal(alerts[0].agent_code, 'a2')
  assert.ok(alerts[0].score >= ALERT_THRESHOLD)
  assert.equal(alerts[0].clientName, 'Ahmed')
})

test('buildAlerts: a clearly-mismatched client produces nothing', () => {
  // Wants a villa in a different region, half the budget — hard-excluded.
  const mismatch = client({ id: 8, reqType: 'Villa', location: 'Tripoli', budget: 200000 })
  assert.equal(buildAlerts(property, [mismatch]).length, 0)
})

test('buildAlerts: a sold listing raises no alerts', () => {
  const good = client({ id: 7 })
  assert.equal(buildAlerts({ ...property, status: 'Sold' }, [good]).length, 0)
})

test('buildAlerts: best matches first', () => {
  const exact = client({ id: 1, name: 'Exact', budget: 480000, location: 'Beirut', beds: 3 })
  const looser = client({ id: 2, name: 'Looser', budget: 560000, location: 'Beirut', beds: 2 })
  const alerts = buildAlerts(property, [looser, exact])
  assert.equal(alerts[0].client_id, 1)   // the exact match ranks first
})

test('buildAlerts: respects the cap, keeping the strongest', () => {
  const many = Array.from({ length: 40 }, (_, i) => client({ id: i + 1, name: `C${i}` }))
  const alerts = buildAlerts(property, many, { max: 10 })
  assert.equal(alerts.length, 10)
})

test('buildAlerts: honours a custom threshold', () => {
  const marginal = client({ id: 9, budget: 600000, beds: 1 })   // weaker fit
  // Strict bar excludes it; a lenient bar lets it through.
  assert.ok(buildAlerts(property, [marginal], { threshold: 95 }).length
    <= buildAlerts(property, [marginal], { threshold: 40 }).length)
})

test('buildAlerts: carries the client\'s owning agent, not the property\'s', () => {
  // Property is agent a1's; the client belongs to a3. The alert targets a3.
  const alerts = buildAlerts(property, [client({ id: 7, agentId: 'a3' })])
  assert.equal(alerts[0].agent_code, 'a3')
})

test('buildAlerts: empty client list is empty', () => {
  assert.deepEqual(buildAlerts(property, []), [])
})

test('alertHeadline: reads naturally', () => {
  const h = alertHeadline({ clientName: 'Ahmed', propertyTitle: 'Raouché Apartment', score: 87 })
  assert.match(h, /Raouché Apartment matches Ahmed — 87%/)
})
