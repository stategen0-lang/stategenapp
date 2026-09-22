// Unit tests for the matching algorithm (src/lib/matching.ts).
// Run with:  npm test   (node --experimental-strip-types --test)
// No test framework needed — uses Node's built-in test runner.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  scoreBudget, scoreLocation, scoreLocationMulti, scoreBedrooms, scoreAmenities,
  propFeatures, computeScore, matchProperties, matchClients, MATCH_THRESHOLD, BUDGET_EXCLUDE, LOCATION_EXCLUDE,
} from './matching.ts'
import { loadAreas } from './lebanon/areas.ts'

// ── scoreLocationMulti: a client open to several areas ───────────────────────
test('scoreLocationMulti: best of the requested areas wins', () => {
  // Property in Achrafieh; client open to Jounieh (far) OR Achrafieh (exact).
  const s = scoreLocationMulti('Achrafieh Beirut', { location: '', locations: ['Jounieh', 'Achrafieh'] })
  assert.equal(s, 100)
})
test('scoreLocationMulti: none matching excludes', () => {
  const s = scoreLocationMulti('Tripoli North', { location: '', locations: ['Jounieh', 'Achrafieh'] })
  assert.equal(s, LOCATION_EXCLUDE)
})
test('scoreLocationMulti: no areas = no constraint', () => {
  assert.equal(scoreLocationMulti('Anywhere', { location: '', locations: [] }), 100)
})
test('scoreLocationMulti: falls back to the single location field', () => {
  assert.equal(scoreLocationMulti('Achrafieh Beirut', { location: 'Achrafieh' }), 100)
})

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
test('scoreLocation: exact area requested → 100', () => {
  assert.equal(scoreLocation('Hamra Beirut', 'Beirut'), 100)
  assert.equal(scoreLocation('Hamra Beirut', 'Hamra'), 100)
})
test('scoreLocation: different district in the same region → 75 (surrounding)', () => {
  // wants Hamra, property in Achrafieh (both Beirut) → 75, not 100
  assert.equal(scoreLocation('Achrafieh Beirut', 'Hamra'), 75)
  assert.equal(scoreLocation('Hamra Beirut', 'Verdun'), 75)
})
test('scoreLocation: neighbouring region → 75 (surrounding)', () => {
  assert.equal(scoreLocation('Dbayeh Metn', 'Hamra'), 75)
  assert.equal(scoreLocation('Hamra Beirut', 'Metn'), 75) // region name recognised
})
test('scoreLocation: far apart → LOCATION_EXCLUDE', () => {
  assert.equal(scoreLocation('Tripoli', 'Zahle'), LOCATION_EXCLUDE)
})
test('scoreLocation: unknown locations → LOCATION_EXCLUDE', () => {
  assert.equal(scoreLocation('Nowhereville', 'Atlantis'), LOCATION_EXCLUDE)
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

test('matchProperties: excludes far-away listings (location hard filter)', () => {
  const c = client({ budget: 500000, req: { location: 'Beirut', beds: 3, type: 'Appartement' } })
  const props = [
    prop({ title: 'near', price: 500000, district: 'Hamra', city: 'Beirut', beds: 3, type: 'Appartement' }),
    prop({ title: 'far',  price: 500000, district: 'Tyre',  city: 'South',  beds: 3, type: 'Appartement' }),
  ]
  assert.deepEqual(matchProperties(c, props).map(r => r.property.title), ['near'])
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

test('propFeatures + wishlist: client must-haves match a listing\'s features', () => {
  const listing = prop({ price: 500000, amenities: ['Pool'], buildingFeatures: ['Elevator', 'Generator'], parkings: 1, terrace: true })
  const wantAll = client({ budget: 500000, req: { type: 'Appartement', location: 'Beirut', beds: 3, amenities: ['Pool'], buildingFeatures: ['Elevator'], parkings: 1, terrace: true } })
  assert.equal(computeScore(listing, wantAll).amenityScore, 100)
  // "Pool" (private) must not be satisfied by a shared pool.
  const shared = prop({ price: 500000, buildingFeatures: ['Shared Pool'] })
  const wantPool = client({ budget: 500000, req: { type: 'Appartement', location: 'Beirut', beds: 3, amenities: ['Pool'] } })
  assert.equal(computeScore(shared, wantPool).amenityScore, 0)
})

// ── Location scoring with the gazetteer ──────────────────────────────────────
// The tests above deliberately run WITHOUT it, covering the fallback for text
// no gazetteer can place. These load it, which is what production does.

const areas = await loadAreas()

test('scoreLocation: the same place, spelled two ways, is the same place', () => {
  // Each of these pairs used to score LOCATION_EXCLUDE — the match simply
  // never appeared, and nobody could tell it was missing.
  const pairs = [
    ['Hazmiyeh', 'Hazmieh'], ['Ashrafiyeh', 'Achrafieh'], ['El Achrafiye', 'achrafieh'],
    ['Jounié', 'Jounieh'], ['Dbaye', 'Dbayeh'], ['Jal ed Dib', 'Jal el Dib'],
    ['Fern el Shebbak', 'Furn el Chebbak'], ['Sidon', 'Saida'], ['Sour', 'Tyre'],
    ['Zahlé', 'Zahle'], ['Shweifat', 'Choueifat'], ['Mansouriyeh', 'Mansourieh'],
  ]
  for (const [filed, wanted] of pairs) {
    assert.equal(scoreLocation(filed, wanted, areas), 100, `${filed} ≠ ${wanted}`)
  }
})

test('scoreLocation: the stored "area, city" pair still resolves', () => {
  assert.equal(scoreLocation('Achrafieh, Beirut', 'ashrafiyeh', areas), 100)
  assert.equal(scoreLocation('Hazmieh, Mount Lebanon', 'Hazmiyeh', areas), 100)
})

test('scoreLocation: graded by real distance', () => {
  assert.equal(scoreLocation('Hamra', 'Achrafieh', areas), 85)        // ~3 km
  assert.equal(scoreLocation('Dbayeh', 'Achrafieh', areas), 75)       // ~11 km
  assert.equal(scoreLocation('Tripoli', 'Achrafieh', areas), LOCATION_EXCLUDE)
  assert.equal(scoreLocation('Saida', 'Jounieh', areas), LOCATION_EXCLUDE)
})

test('scoreLocation: a place up the mountain is no longer "surrounding"', () => {
  // The old zone table paired Beirut with the whole Chouf, so a village 35 km
  // away scored the same 75 as Dbayeh.
  assert.equal(scoreLocation('Barouk', 'Achrafieh', areas), LOCATION_EXCLUDE)
})

test('scoreLocation: text the gazetteer cannot place falls back, never crashes', () => {
  assert.equal(scoreLocation('Behind the Old Mill Road', 'Achrafieh', areas), LOCATION_EXCLUDE)
  assert.equal(scoreLocation('Hamra Beirut', 'Verdun', areas), 75)   // zone fallback
  assert.equal(scoreLocation('Achrafieh', '', areas), 100)
  assert.equal(scoreLocation('', 'Achrafieh', areas), LOCATION_EXCLUDE)
})

test('scoreLocationMulti: every area the client named counts, in any spelling', () => {
  const req = { location: '', locations: ['Ashrafiyeh', 'Jounié', 'Hazmiyeh'] }
  assert.equal(scoreLocationMulti('Achrafieh', req, areas), 100)
  assert.equal(scoreLocationMulti('Hazmieh', req, areas), 100)
  assert.equal(scoreLocationMulti('Jounieh', req, areas), 100)
  assert.equal(scoreLocationMulti('Tripoli', req, areas), LOCATION_EXCLUDE)
})

test('matchProperties: the listing filed under another spelling now shows up', () => {
  const props = [
    prop({ id: 1, title: 'spelled differently', district: '', city: 'Hazmiyeh', price: 300000 }),
    prop({ id: 2, title: 'far away', district: '', city: 'Tripoli', price: 300000 }),
  ]
  const c = client({ budget: 300000, req: { type: 'Appartement', location: 'Hazmieh', beds: 3 } })
  const titles = matchProperties(c, props, MATCH_THRESHOLD, areas).map(r => r.property.title)
  assert.deepEqual(titles, ['spelled differently'])
})

// ── Regions ─────────────────────────────────────────────────────────────────
// Agents name a caza as readily as a town. "Metn" is not a populated place, so
// the place lookup reached a village called El Mtain through the consonant
// skeleton, and every client asking for the Metn stopped matching anything.

test('scoreLocation: a caza means the whole caza, not a village that sounds like it', () => {
  assert.equal(scoreLocation('Dbayeh', 'Metn', areas), 100)
  assert.equal(scoreLocation('Broummana', 'Metn', areas), 100)
  assert.equal(scoreLocation('Mansourieh', 'Metn', areas), 100)
  assert.equal(scoreLocation('Jounieh', 'Keserwan', areas), 100)
  assert.equal(scoreLocation('Deir el Qamar', 'Chouf', areas), 100)
  assert.equal(scoreLocation('Zahle', 'Bekaa', areas), 100)
})

test('scoreLocation: a governorate means every district in it', () => {
  assert.equal(scoreLocation('Achrafieh', 'Beirut', areas), 100)
  assert.equal(scoreLocation('Hamra', 'Beirut', areas), 100)
  assert.equal(scoreLocation('Gemmayzeh', 'Beirut', areas), 100)
})

test('scoreLocation: next to a region counts, far from it does not', () => {
  assert.equal(scoreLocation('Achrafieh', 'Metn', areas), 85)      // minutes away at Sin el Fil
  assert.equal(scoreLocation('Saida', 'Metn', areas), LOCATION_EXCLUDE)
  assert.equal(scoreLocation('Tripoli', 'Metn', areas), LOCATION_EXCLUDE)
  // Measured to the region's nearest edge, not its middle: a governorate is
  // not "nearby" just because one corner of it is.
  assert.equal(scoreLocation('Jounieh', 'Beirut', areas), 75)
  assert.equal(scoreLocation('Aaqoura', 'Beirut', areas), LOCATION_EXCLUDE)
  assert.equal(scoreLocation('Barouk', 'Beirut', areas), LOCATION_EXCLUDE)
})

test('scoreLocation: a caza that is also a town still means the town', () => {
  // Aaqoura shares the Jbeil caza but is 30 km up the mountain from Jbeil.
  assert.equal(scoreLocation('Aaqoura', 'Jbeil', areas), LOCATION_EXCLUDE)
  assert.equal(scoreLocation('Amchit', 'Jbeil', areas), 85)
  assert.equal(scoreLocation('Hazmieh', 'Baabda', areas), 85)
})

test('scoreLocation: a guessed place never decides a match', () => {
  // Only a confident resolution may drive the distance rule; anything fuzzier
  // falls back, because a wrong guess silently excludes real matches.
  assert.notEqual(scoreLocation('Dbayeh', 'Metn', areas), LOCATION_EXCLUDE)
  assert.notEqual(scoreLocation('Bourj Hammoud', 'Metn', areas), LOCATION_EXCLUDE)
})

test('matchProperties: a client who named a caza still gets their matches', () => {
  const props = [
    prop({ id: 1, title: 'in the metn', district: 'Dbayeh', city: 'Metn', price: 300000, type: 'Appartement' }),
    prop({ id: 2, title: 'far south', district: '', city: 'Saida', price: 300000, type: 'Appartement' }),
  ]
  const c = client({ budget: 300000, req: { type: 'Appartement', location: 'Metn', locations: ['Metn'], beds: 3 } })
  assert.deepEqual(matchProperties(c, props, MATCH_THRESHOLD, areas).map(r => r.property.title), ['in the metn'])
})
