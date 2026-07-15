// Unit tests for the matching algorithm (src/lib/matching.ts).
// Run with:  npm test   (node --experimental-strip-types --test)
// No test framework needed — uses Node's built-in test runner.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreBudget, scoreLocation, scoreBedrooms, scoreAmenities,
  propFeatures, computeScore, matchProperties, matchClients, MATCH_THRESHOLD,
} from './matching.ts'

// ── fixtures ────────────────────────────────────────────────────────────────
const prop = (o = {}) => ({
  type: 'Appartement', transaction: 'For Sale', price: 500000, rent: 0,
  district: 'Hamra', city: 'Beirut', beds: 3, baths: 2, size: 150,
  garden: false, balcony: false, view: '', status: 'Available', photos: [],
  ...o,
})

const client = (o = {}) => ({
  budget: o.budget ?? 0,
  req: {
    transaction: '', type: '', location: '', priceMin: 0, priceMax: 0,
    beds: 0, baths: 0, size: 0, garden: false, balcony: false, notes: '',
    ...(o.req || {}),
  },
})

// ── scoreBudget ─────────────────────────────────────────────────────────────
test('scoreBudget: no budget given → 100', () => {
  assert.equal(scoreBudget(500000, 0), 100)
})
test('scoreBudget: budget covers price → 100', () => {
  assert.equal(scoreBudget(500000, 600000), 100)
  assert.equal(scoreBudget(500000, 500000), 100)
})
test('scoreBudget: 10% over budget → partial (33)', () => {
  assert.equal(scoreBudget(500000, 450000), 33)
})
test('scoreBudget: more than 15% over budget → 0', () => {
  assert.equal(scoreBudget(500000, 400000), 0)
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
    prop({ price: 400000, garden: true }),
    client({ budget: 500000, req: { type: 'Appartement', location: 'Beirut', priceMax: 500000, beds: 3, garden: true } }),
  )
  assert.equal(s.total, 100)
  assert.equal(s.budgetScore, 100)
  assert.equal(s.locationScore, 100)
})
test('computeScore: property-type mismatch zeroes the type sub-score (85 total)', () => {
  const s = computeScore(
    prop({ price: 400000, garden: true }),
    client({ budget: 500000, req: { type: 'Villa', location: 'Beirut', priceMax: 500000, beds: 3, garden: true } }),
  )
  assert.equal(s.typeScore, 0)
  assert.equal(s.total, 85) // 40 + 25 + 0 + 12 + 8
})
test('computeScore: rental budget uses annualised rent (rent × 12)', () => {
  // 3000/mo → 36,000/yr, which is >15% over a 30,000 budget → budgetScore 0.
  const s = computeScore(
    prop({ transaction: 'For Rent', rent: 3000, price: 0 }),
    client({ budget: 30000, req: { priceMax: 30000 } }),
  )
  assert.equal(s.budgetScore, 0)
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
