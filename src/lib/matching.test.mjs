// Unit tests for the matching algorithm (src/lib/matching.ts).
// Run with:  npm test   (node --experimental-strip-types --test)
// No test framework needed — uses Node's built-in test runner.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreBudget, scoreLocation, scoreBedrooms, scoreAmenities,
  propFeatures, computeScore, matchProperties, matchClients, MATCH_THRESHOLD, BUDGET_EXCLUDE,
} from './matching.ts'

// ── fixtures ────────────────────────────────────────────────────────────────
const prop = (o = {}) => ({
  type: 'Appartement', transaction: 'For Sale', price: 500000, rent: 0,
  district: 'Hamra', city: 'Beirut', beds: 3, baths: 2, size: 150,
  garden: false, balcony: false, view: '', status: 'Available', photos: [],
  ...o,
})

const client = (o = {}) => ({
  type: o.type,               // 'Buyer' | 'Renter' | undefined
  budget: o.budget ?? 0,
  req: {
    transaction: '', type: '', location: '', priceMin: 0, priceMax: 0,
    beds: 0, baths: 0, size: 0, garden: false, balcony: false, notes: '',
    ...(o.req || {}),
  },
})

// ── scoreBudget (single budget, symmetric: ±10→100, ±20→80, ±30→50, ±50→25, else exclude)
test('scoreBudget: no budget given → 100', () => {
  assert.equal(scoreBudget(500000, 0), 100)
})
test('scoreBudget: within ±10% → 100 (either direction)', () => {
  assert.equal(scoreBudget(500000, 500000), 100)
  assert.equal(scoreBudget(550000, 500000), 100) // +10%
  assert.equal(scoreBudget(450000, 500000), 100) // -10%
})
test('scoreBudget: ±20% → 80', () => {
  assert.equal(scoreBudget(600000, 500000), 80) // +20%
  assert.equal(scoreBudget(400000, 500000), 80) // -20%
})
test('scoreBudget: ±30% → 50', () => {
  assert.equal(scoreBudget(650000, 500000), 50) // +30%
  assert.equal(scoreBudget(350000, 500000), 50) // -30%
})
test('scoreBudget: ±50% → 25', () => {
  assert.equal(scoreBudget(725000, 500000), 25) // +45%
  assert.equal(scoreBudget(275000, 500000), 25) // -45%
})
test('scoreBudget: beyond ±50% → BUDGET_EXCLUDE', () => {
  assert.equal(scoreBudget(800000, 500000), BUDGET_EXCLUDE) // +60%
  assert.equal(scoreBudget(200000, 500000), BUDGET_EXCLUDE) // -60%
})

// ── scoreLocation ───────────────────────────────────────────────────────────
test('scoreLocation: no client location → 100', () => {
  assert.equal(scoreLocation('Hamra Beirut', ''), 100)
})
test('scoreLocation: substring / same district → 100', () => {
  assert.equal(scoreLocation('Hamra Beirut', 'Beirut'), 100)
  assert.equal(scoreLocation('Hamra Beirut', 'Hamra'), 100)
})
test('scoreLocation: same zone, different district → 60', () => {
  assert.equal(scoreLocation('Hamra Beirut', 'Verdun'), 60)
})
test('scoreLocation: neighbouring zones (Beirut ↔ Metn) → 35', () => {
  assert.equal(scoreLocation('Dbayeh Metn', 'Hamra'), 35)
})
test('scoreLocation: both known but far apart → 15', () => {
  assert.equal(scoreLocation('Tripoli', 'Zahle'), 15)
})
test('scoreLocation: unknown locations → 0', () => {
  assert.equal(scoreLocation('Nowhereville', 'Atlantis'), 0)
})

// ── scoreBedrooms ───────────────────────────────────────────────────────────
test('scoreBedrooms: no preference → 100', () => {
  assert.equal(scoreBedrooms(3, 0), 100)
})
test('scoreBedrooms: exact / off-by-1 / off-by-2 / off-by-3', () => {
  assert.equal(scoreBedrooms(3, 3), 100)
  assert.equal(scoreBedrooms(3, 4), 80)
  assert.equal(scoreBedrooms(3, 5), 40)
  assert.equal(scoreBedrooms(3, 6), 0)
})

// ── scoreAmenities ──────────────────────────────────────────────────────────
test('scoreAmenities: empty wishlist → 100', () => {
  assert.equal(scoreAmenities([], []), 100)
})
test('scoreAmenities: all / half / none matched', () => {
  assert.equal(scoreAmenities(['garden', 'balcony'], ['garden']), 100)
  assert.equal(scoreAmenities(['garden'], ['garden', 'balcony']), 50)
  assert.equal(scoreAmenities(['balcony'], ['garden']), 0)
})

// ── propFeatures ────────────────────────────────────────────────────────────
test('propFeatures: garden + balcony + view, excludes Street view', () => {
  assert.deepEqual(propFeatures(prop({ garden: true, balcony: true, view: 'Sea' })), ['garden', 'balcony', 'sea view'])
  assert.deepEqual(propFeatures(prop({ view: 'Street' })), [])
})

// ── computeScore (integration) ──────────────────────────────────────────────
test('computeScore: perfect match → 100', () => {
  const s = computeScore(
    prop({ price: 500000, garden: true }),
    client({ budget: 500000, req: { type: 'Appartement', location: 'Beirut', beds: 3, garden: true } }),
  )
  assert.equal(s.total, 100)
  assert.equal(s.budgetScore, 100)
  assert.equal(s.locationScore, 100)
})
test('computeScore: specified-but-mismatched property type → ineligible (hard filter)', () => {
  const s = computeScore(
    prop({ type: 'Appartement', price: 400000 }),
    client({ budget: 500000, req: { type: 'Shop', location: 'Beirut', priceMax: 500000, beds: 3 } }),
  )
  assert.equal(s.typeScore, 0)
  assert.equal(s.eligible, false)
})
test('computeScore: no client type preference does not filter (eligible)', () => {
  const s = computeScore(
    prop({ type: 'Shop', price: 400000, district: 'Hamra', city: 'Beirut' }),
    client({ budget: 500000, req: { type: '', location: 'Beirut', priceMax: 500000, beds: 0 } }),
  )
  assert.equal(s.eligible, true)
})
test('computeScore: rental compares MONTHLY rent to the budget (not annualised)', () => {
  // Renter budget 2000 vs a 2000/mo rental → perfect. If it wrongly used
  // rent×12 (24,000) this would instead be excluded.
  const s = computeScore(
    prop({ transaction: 'For Rent', rent: 2000, price: 0, type: 'Appartement', district: 'Hamra', city: 'Beirut' }),
    client({ type: 'Renter', budget: 2000, req: { location: 'Beirut', beds: 0 } }),
  )
  assert.equal(s.budgetScore, 100)
  assert.equal(s.eligible, true)
})

// ── matchProperties / matchClients ──────────────────────────────────────────
test('matchProperties: drops sub-threshold + Sold, keeps strong matches', () => {
  const c = client({ budget: 500000, req: { location: 'Beirut', priceMax: 500000, beds: 3, type: 'Appartement' } })
  const props = [
    prop({ title: 'perfect', price: 400000, district: 'Hamra', city: 'Beirut', beds: 3, type: 'Appartement' }),
    prop({ title: 'sold', price: 400000, district: 'Hamra', city: 'Beirut', beds: 3, type: 'Appartement', status: 'Sold' }),
    prop({ title: 'weak', price: 900000, district: 'Tripoli', city: 'Tripoli', beds: 6, type: 'Villa' }),
  ]
  const res = matchProperties(c, props)
  assert.equal(res.length, 1)
  assert.equal(res[0].property.title, 'perfect')
  assert.ok(res[0].score.total >= MATCH_THRESHOLD)
})

test('matchProperties: ordered by descending score', () => {
  const c = client({ budget: 500000, req: { location: 'Beirut', priceMax: 500000, beds: 3, type: 'Appartement' } })
  const props = [
    prop({ title: 'good', price: 400000, district: 'Hamra', city: 'Beirut', beds: 4, type: 'Appartement' }),
    prop({ title: 'best', price: 400000, district: 'Hamra', city: 'Beirut', beds: 3, type: 'Appartement' }),
  ]
  assert.deepEqual(matchProperties(c, props).map(r => r.property.title), ['best', 'good'])
})

// ── transaction (buy vs rent) hard filter ────────────────────────────────────
test('computeScore: a Buyer is excluded from a rental listing', () => {
  const s = computeScore(
    prop({ transaction: 'For Rent', rent: 1500, price: 0, type: 'Appartement', district: 'Hamra', city: 'Beirut' }),
    client({ type: 'Buyer', budget: 500000, req: { location: 'Beirut', priceMax: 500000, beds: 2 } }),
  )
  assert.equal(s.eligible, false)
})
test('computeScore: a Renter is excluded from a sale listing', () => {
  const s = computeScore(
    prop({ transaction: 'For Sale', price: 400000, type: 'Appartement', district: 'Hamra', city: 'Beirut' }),
    client({ type: 'Renter', budget: 30000, req: { location: 'Beirut', priceMax: 30000, beds: 2 } }),
  )
  assert.equal(s.eligible, false)
})
test('computeScore: explicit req.transaction drives the filter', () => {
  const s = computeScore(
    prop({ transaction: 'For Sale', price: 400000, type: 'Appartement', district: 'Hamra', city: 'Beirut' }),
    client({ budget: 500000, req: { transaction: 'For Rent', location: 'Beirut', priceMax: 500000, beds: 2 } }),
  )
  assert.equal(s.eligible, false)
})
test('matchProperties: a Buyer only sees sale listings', () => {
  const c = client({ type: 'Buyer', budget: 600000, req: { type: 'Appartement', location: 'Beirut', priceMin: 300000, priceMax: 600000, beds: 2 } })
  const props = [
    prop({ title: 'sale', transaction: 'For Sale', price: 500000, type: 'Appartement', district: 'Hamra', city: 'Beirut', beds: 2 }),
    prop({ title: 'rent', transaction: 'For Rent', rent: 1500, price: 0, type: 'Appartement', district: 'Hamra', city: 'Beirut', beds: 2 }),
  ]
  assert.deepEqual(matchProperties(c, props).map(r => r.property.title), ['sale'])
})

test('matchProperties: excludes wrong-type and >±50%-off-budget listings', () => {
  const c = client({ budget: 600000, req: { type: 'Appartement', location: 'Beirut', priceMin: 400000, priceMax: 600000, beds: 3 } })
  const props = [
    prop({ title: 'right',        type: 'Appartement', price: 500000, district: 'Hamra', city: 'Beirut', beds: 3 }),
    prop({ title: 'wrong-type',   type: 'Shop',        price: 500000, district: 'Hamra', city: 'Beirut', beds: 3 }),
    prop({ title: 'too-pricey',   type: 'Appartement', price: 1000000, district: 'Hamra', city: 'Beirut', beds: 3 }),
  ]
  assert.deepEqual(matchProperties(c, props).map(r => r.property.title), ['right'])
})

test('matchClients: sorts best-first and honours the threshold', () => {
  const p = prop({ price: 400000, district: 'Hamra', city: 'Beirut', beds: 3, type: 'Appartement' })
  const clients = [
    client({ budget: 500000, req: { location: 'Beirut', priceMax: 500000, beds: 3, type: 'Appartement' } }),
    client({ budget: 100000, req: { location: 'Tripoli', priceMax: 100000, beds: 1, type: 'Villa' } }),
  ]
  const res = matchClients(p, clients)
  assert.equal(res.length, 1)
  assert.ok(res[0].score.total >= MATCH_THRESHOLD)
})
