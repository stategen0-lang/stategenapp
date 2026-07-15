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
  budget: o.budget ?? 0,
  req: {
    transaction: '', type: '', location: '', priceMin: 0, priceMax: 0,
    beds: 0, baths: 0, size: 0, garden: false, balcony: false, notes: '',
    ...(o.req || {}),
  },
})

// ── scoreBudget (symmetric bands: ±10→100, ±20→80, ±30→50, ±50→25, else exclude)
test('scoreBudget: no budget given → 100', () => {
  assert.equal(scoreBudget(500000, 0, 0), 100)
})
test('scoreBudget: price inside [min, max] → 100 (incl. bounds)', () => {
  assert.equal(scoreBudget(500000, 400000, 600000), 100)
  assert.equal(scoreBudget(400000, 400000, 600000), 100)
  assert.equal(scoreBudget(600000, 400000, 600000), 100)
})
test('scoreBudget: bands above the max', () => {
  assert.equal(scoreBudget(660000, 400000, 600000), 100) // +10%
  assert.equal(scoreBudget(720000, 400000, 600000), 80)  // +20%
  assert.equal(scoreBudget(780000, 400000, 600000), 50)  // +30%
  assert.equal(scoreBudget(870000, 400000, 600000), 25)  // +45%
})
test('scoreBudget: symmetric below the min', () => {
  assert.equal(scoreBudget(360000, 400000, 600000), 100) // -10%
  assert.equal(scoreBudget(300000, 400000, 600000), 50)  // -25%
})
test('scoreBudget: beyond ±50% → BUDGET_EXCLUDE', () => {
  assert.equal(scoreBudget(960000, 400000, 600000), BUDGET_EXCLUDE) // +60%
  assert.equal(scoreBudget(150000, 400000, 600000), BUDGET_EXCLUDE) // -62.5%
})
test('scoreBudget: only a max set is one-sided', () => {
  assert.equal(scoreBudget(500000, 0, 600000), 100) // under max → in range
  assert.equal(scoreBudget(700000, 0, 600000), 80)  // +16.7% over max
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
test('computeScore: rental budget uses annualised rent (rent × 12)', () => {
  // 5000/mo → 60,000/yr, which is >50% over a 30,000 budget → excluded.
  // (If it wrongly used the monthly figure, 5,000 would be within budget.)
  const s = computeScore(
    prop({ transaction: 'For Rent', rent: 5000, price: 0 }),
    client({ budget: 30000, req: { priceMax: 30000 } }),
  )
  assert.equal(s.budgetScore, 0)
  assert.equal(s.eligible, false)
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
