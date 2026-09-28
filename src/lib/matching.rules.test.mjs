// node --experimental-strip-types --test src/lib/matching.rules.test.mjs
//
// The matching rules the agency set in September 2026, before their team came
// on. Every one of these is a decision somebody made on purpose — if one starts
// failing, it was changed by accident, not improved.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeScore, matchProperties, matchClients, scoreLocation, mustHaves, hasBrief,
  MATCH_THRESHOLD, MAX_MATCHES, LOCATION_EXCLUDE,
} from './matching.ts'
import { loadAreas } from './lebanon/areas.ts'

const areas = await loadAreas()

const prop = (o = {}) => ({
  id: 1, title: 'L', type: 'Appartement', transaction: 'For Sale', price: 500000, rent: 0,
  district: '', city: 'Achrafieh', beds: 3, baths: 2, size: 150, parkings: 0,
  garden: false, balcony: false, view: '', status: 'Available', agentId: 'a1', photos: [],
  amenities: [], buildingFeatures: [], ...o,
})
const client = (o = {}) => ({
  id: 1, name: 'C', type: o.type ?? 'Buyer', email: '', phone: '',
  budget: o.budget ?? 500000, agentId: 'a2', status: 'Searching', leadScore: 0, agentRating: 3,
  req: {
    transaction: 'For Sale', type: 'Appartement', location: 'Achrafieh',
    priceMin: 0, priceMax: 0, beds: 3, baths: 0, size: 0, garden: false, balcony: false, notes: '',
    ...(o.req ?? {}),
  },
})

// ── Weights: location 40 · budget 30 · must-haves 18 · bedrooms 12 ──────────

test('a perfect match is 100, and each part is worth what it should be', () => {
  const p = prop(), c = client()
  assert.equal(computeScore(p, c, areas).total, 100)

  // Location is 40%: dropping to "surrounding" (75) costs 10 points.
  assert.equal(computeScore(prop({ city: 'Hamra' }), c, areas).total, 90)
  // Budget is 30%: ±20% (75) costs 7.5.
  assert.equal(computeScore(prop({ price: 600000 }), c, areas).total, 92.5)
  // Bedrooms are 12%: one off (80) costs 2.4.
  assert.equal(computeScore(prop({ beds: 4 }), c, areas).total, 97.6)
  // Must-haves are 18%: asking for one thing and not getting it costs all 18.
  assert.equal(computeScore(p, client({ req: { amenities: ['Pool'] } }), areas).total, 82)
})

test('type is a hard filter and no longer a score', () => {
  const s = computeScore(prop({ type: 'Villa' }), client(), areas)
  assert.equal(s.eligible, false, 'a villa is not a fraction of an apartment')
  assert.equal('typeScore' in s, false, 'type is not a scored part any more')
  assert.equal(matchProperties(client(), [prop({ type: 'Villa' })], MATCH_THRESHOLD, areas).length, 0)
})

// ── The six requirements that used to be ignored ────────────────────────────

test('view, furnishing, bathrooms, size, building age and floor all count now', () => {
  const c = client({ req: {
    view: 'Sea', furnishing: 'Furnished', baths: 3, size: 200, buildingAge: 5, floor: 'Last floor' } })
  const none = prop({ view: '', furnishing: '', baths: 1, size: 90, buildingAge: 40, floor: 'Ground level' })
  const all = prop({ view: 'Sea', furnishing: 'Furnished', baths: 3, size: 200, buildingAge: 2, floor: 'Last floor' })

  assert.equal(computeScore(all, c, areas).mustHaveScore, 100)
  assert.equal(computeScore(none, c, areas).mustHaveScore, 0)
  // An 18-point gap. It used to be nothing at all: a listing with none of what
  // the client asked for scored exactly the same as one with all of it.
  assert.equal(computeScore(all, c, areas).total - computeScore(none, c, areas).total, 18)
})

test('must-haves are listed one by one, so the card shows what is missing', () => {
  const c = client({ req: { view: 'Sea', baths: 3, garden: true } })
  const p = prop({ view: 'Sea', baths: 1, garden: false })
  assert.deepEqual(
    mustHaves(p, c.req).map(i => `${i.met ? 'yes' : 'no'} ${i.label}`),
    ['no Garden', 'yes Sea view', 'no 3 bathrooms'])
  assert.equal(computeScore(p, c, areas).mustHaveScore, 33)
})

test('a size or bathroom count is a minimum, an age is a maximum', () => {
  const c = client({ req: { beds: 0, size: 150, baths: 2, buildingAge: 10 } })
  assert.equal(computeScore(prop({ size: 300, baths: 4, buildingAge: 1 }), c, areas).mustHaveScore, 100,
    'more than asked for is still met')
  assert.equal(computeScore(prop({ size: 300, baths: 4, buildingAge: 25 }), c, areas).mustHaveScore, 67,
    'too old is not met')
  // A listing that never says how old it is cannot be claimed to be under the limit.
  assert.equal(computeScore(prop({ size: 300, baths: 4 }), c, areas).mustHaveScore, 67)
})

// ── A client with nothing on file ───────────────────────────────────────────

test('a client saved with just a name matches nothing at all', () => {
  // They used to match every listing in the agency at a perfect 100%, and at
  // that score every one of them raised an alert.
  const blank = client({ budget: 0, req: { transaction: '', type: '', location: '', beds: 0 } })
  assert.equal(hasBrief(blank), false)
  const listings = [prop(), prop({ id: 2, type: 'Land', price: 3000000, city: 'Baalbek', beds: 0 })]
  assert.deepEqual(matchProperties(blank, listings, MATCH_THRESHOLD, areas), [])
  assert.deepEqual(matchClients(listings[0], [blank], MATCH_THRESHOLD, areas), [])
})

test('any one of budget, area or type is enough of a brief', () => {
  const bare = { transaction: '', type: '', location: '', beds: 0 }
  assert.equal(hasBrief(client({ budget: 300000, req: bare })), true)
  assert.equal(hasBrief(client({ budget: 0, req: { ...bare, location: 'Achrafieh' } })), true)
  assert.equal(hasBrief(client({ budget: 0, req: { ...bare, locations: ['Achrafieh'] } })), true)
  assert.equal(hasBrief(client({ budget: 0, req: { ...bare, type: 'Villa' } })), true)
  assert.equal(hasBrief(client({ budget: 0, req: { ...bare, location: '   ' } })), false, 'whitespace is not an area')
})

// ── Listings that are spoken for ────────────────────────────────────────────

test('sold, rented and reserved listings are never offered', () => {
  const shown = {}
  for (const status of ['Available', 'Pending', 'Reserved', 'Sold', 'Rented', 'Under Construction', '']) {
    shown[status || '(blank)'] = matchProperties(client(), [prop({ status })], MATCH_THRESHOLD, areas).length === 1
  }
  assert.deepEqual(shown, {
    Available: true,
    Pending: true,               // a deposit can fall through
    'Under Construction': true,  // off-plan is sold here every day
    '(blank)': true,             // older and imported rows
    Reserved: false,
    Sold: false,
    Rented: false,
  })
  // And a listing that is spoken for raises no alerts either.
  assert.deepEqual(matchClients(prop({ status: 'Rented' }), [client()], MATCH_THRESHOLD, areas), [])
})

// ── Bint Jbeil ──────────────────────────────────────────────────────────────

test('a name that merely contains another is not the same place', () => {
  // "Bint Jbeil" contains "Jbeil" and is 113 km from it. It used to score 100.
  assert.equal(scoreLocation('Bint Jbeil', 'Jbeil', areas), LOCATION_EXCLUDE)
  assert.equal(scoreLocation('Zokak el Blat', 'Blat', areas), LOCATION_EXCLUDE)
  // But a listing filed as "area, city" still matches the area exactly.
  assert.equal(scoreLocation('Achrafieh, Beirut', 'Achrafieh', areas), 100)
})

// ── Several areas on one client ─────────────────────────────────────────────

test('a client open to several areas is scored on the best of them', () => {
  const c = client({ req: {
    location: 'Achrafieh, Jounieh, Batroun', locations: ['Achrafieh', 'Jounieh', 'Batroun'] } })

  for (const [city, expected] of [['Achrafieh', 100], ['Jounieh', 100], ['Batroun', 100], ['Kaslik', 85]]) {
    assert.equal(computeScore(prop({ city }), c, areas).locationScore, expected, city)
  }
  // Somewhere none of the three reaches is still excluded.
  assert.equal(computeScore(prop({ city: 'Tripoli' }), c, areas).eligible, false)

  // All three areas find their listing — the list is not just the first area's.
  const inventory = ['Achrafieh', 'Jounieh', 'Batroun', 'Tripoli', 'Saida']
    .map((city, i) => prop({ id: i + 1, city }))
  assert.deepEqual(
    matchProperties(c, inventory, MATCH_THRESHOLD, areas).map(m => m.property.city).sort(),
    ['Achrafieh', 'Batroun', 'Jounieh'])
})

test('the multi-area list wins over the single field when both are set', () => {
  const c = client({ req: { location: 'Achrafieh', locations: ['Batroun'] } })
  assert.equal(computeScore(prop({ city: 'Batroun' }), c, areas).locationScore, 100)
})

// ── Fifty is the whole list ─────────────────────────────────────────────────

test('no more than fifty matches are ever returned', () => {
  const many = Array.from({ length: 200 }, (_, i) => prop({ id: i + 1 }))
  assert.equal(matchProperties(client(), many, MATCH_THRESHOLD, areas).length, MAX_MATCHES)

  const clients = Array.from({ length: 200 }, (_, i) => client({ id: i + 1 }))
  assert.equal(matchClients(many[0], clients, MATCH_THRESHOLD, areas).length, MAX_MATCHES)
})

test('the fifty kept are the best fifty', () => {
  const strong = Array.from({ length: 60 }, (_, i) => prop({ id: i + 1 }))
  const weak = Array.from({ length: 60 }, (_, i) => prop({ id: 100 + i, price: 640000, city: 'Hamra', beds: 5 }))
  const got = matchProperties(client(), [...weak, ...strong], MATCH_THRESHOLD, areas)
  assert.equal(got.length, MAX_MATCHES)
  assert.ok(got.every(m => m.score.total === 100), 'a weaker match displaced a perfect one')
})
