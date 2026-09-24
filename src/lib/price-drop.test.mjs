// Unit tests for price-drop alerts (src/lib/price-drop.ts).
// The matching engine is tested elsewhere; here we test which clients a cut
// newly brings into range, and what counts as a cut at all.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceDropAlerts, isMeaningfulDrop, dropPercent, askingPrice, dropLine, MIN_DROP_PCT } from './price-drop.ts'

// The same Raouché apartment the alerts tests use, listed at 480k.
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

// ── What counts as a drop ────────────────────────────────────────────────────

test('a drop is measured against what the price was', () => {
  assert.equal(Math.round(dropPercent(480000, 450000)), 6)
  assert.equal(dropPercent(480000, 240000), 50)
  assert.equal(dropPercent(480000, 480000), 0)   // unchanged
  assert.equal(dropPercent(450000, 480000), 0)   // a rise is not a drop
})

test('a nudge is not news', () => {
  assert.ok(isMeaningfulDrop(480000, 450000))          // 6%
  assert.ok(!isMeaningfulDrop(480000, 478000))         // 0.4% — an owner rounding down
  assert.ok(isMeaningfulDrop(100, 100 - MIN_DROP_PCT)) // exactly at the line counts
})

test('clearing the price is not a discount', () => {
  // "Price on request" — the field was emptied, not cut.
  assert.equal(isMeaningfulDrop(480000, 0), false)
  assert.equal(isMeaningfulDrop(0, 450000), false)
})

test('a rental is judged on its rent, a sale on its price', () => {
  assert.equal(askingPrice(property), 480000)
  assert.equal(askingPrice({ transaction: 'For Rent', price: 480000, rent: 1200 }), 1200)
})

// ── Who gets told ────────────────────────────────────────────────────────────

test('a client the cut brings into range is alerted', () => {
  // 300k budget against a 480k listing is outside the ±50% band — invisible.
  // At 330k it is in range and scores well.
  const reach = client({ id: 7, name: 'Charbel', budget: 300000, agentId: 'a2' })
  assert.equal(priceDropAlerts(property, [reach], 480000).length, 0, 'no cut, no alert')

  const alerts = priceDropAlerts({ ...property, price: 330000 }, [reach], 480000)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].client_id, 7)
  assert.equal(alerts[0].agent_code, 'a2')
  assert.equal(alerts[0].clientName, 'Charbel')
})

test('a client who already matched is NOT told again', () => {
  // This is the whole design: they were already alerted when the listing went
  // up, so a cut is not news to them and the list stays worth reading.
  const already = client({ id: 1, name: 'Already', budget: 480000 })
  const alerts = priceDropAlerts({ ...property, price: 450000 }, [already], 480000)
  assert.equal(alerts.length, 0)
})

test('only the clients the cut actually reached, out of a mixed list', () => {
  const already = client({ id: 1, name: 'Already', budget: 480000 })   // matched before
  const reached = client({ id: 2, name: 'Reached', budget: 300000 })   // matched only now
  const far = client({ id: 3, name: 'Far', budget: 90000 })            // still out of reach
  const alerts = priceDropAlerts({ ...property, price: 330000 }, [already, reached, far], 480000)
  assert.deepEqual(alerts.map(a => a.client_id), [2])
})

test('a rise, a nudge and a sold listing raise nothing', () => {
  const reach = client({ id: 7, budget: 300000 })
  assert.equal(priceDropAlerts({ ...property, price: 520000 }, [reach], 480000).length, 0)
  assert.equal(priceDropAlerts({ ...property, price: 479000 }, [reach], 480000).length, 0)
  assert.equal(priceDropAlerts({ ...property, price: 330000, status: 'Sold' }, [reach], 480000).length, 0)
})

test('a rent cut is compared against the rent, not the price', () => {
  const rental = { ...property, transaction: 'For Rent', price: 0, rent: 700 }
  const renter = client({ id: 9, type: 'Renter', transaction: 'For Rent', budget: 450 })
  assert.equal(priceDropAlerts(rental, [renter], 1200).length, 0, '700 is still out of a 450 budget')

  const alerts = priceDropAlerts({ ...rental, rent: 500 }, [renter], 1200)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].client_id, 9)
})

test('best match first, and the cap is respected', () => {
  const many = Array.from({ length: 40 }, (_, i) => client({ id: i + 1, name: `C${i}`, budget: 300000 }))
  const alerts = priceDropAlerts({ ...property, price: 330000 }, many, 480000, { max: 10 })
  assert.equal(alerts.length, 10)
  assert.ok(alerts[0].score >= alerts[9].score)
})

test('the line an agent reads', () => {
  assert.equal(dropLine(480000, 450000), '$480,000 → $450,000 (6% off)')
  assert.equal(dropLine(1200, 900, true), '$1,200/mo → $900/mo (25% off)')
})
