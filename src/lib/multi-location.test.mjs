// node --experimental-strip-types --test src/lib/multi-location.test.mjs
//
// A client open to several areas, end to end: the shape the form sends, through
// the row the API stores, back through the mapper the app reads, into the
// matcher. Every one of those steps has dropped `locations` at some point in
// its life, and each time the symptom was the same — the client matched only
// their first area and nobody could see why.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbRowToClient } from './db-mappers.ts'
import { matchProperties, computeScore, MATCH_THRESHOLD } from './matching.ts'
import { loadAreas } from './lebanon/areas.ts'

const areas = await loadAreas()

/** What NewClientModal's reqWithLocations() produces for three chips. */
const formReq = {
  transaction: 'For Sale', type: 'Appartement',
  location: 'Achrafieh, Jounieh, Batroun',
  locations: ['Achrafieh', 'Jounieh', 'Batroun'],
  priceMin: 500000, priceMax: 500000, beds: 3, baths: 0, size: 0,
  garden: false, balcony: false, notes: '',
}

/** The row the API writes: columns, plus the whole req inside the notes blob. */
const storedRow = (req) => ({
  id: 7,
  'Client Name': 'Charbel',
  'client phone': '03 111 222',
  'prefered-location': req.location,
  budget_min: req.priceMin,
  budget_max: req.priceMax,
  bedrooms: req.beds,
  payment_terms: req.transaction,
  status: 'Searching',
  notes: JSON.stringify({ agentId: 'NH-1', email: '', req }),
})

const prop = (city, o = {}) => ({
  id: 1, title: 'L', type: 'Appartement', transaction: 'For Sale', price: 500000, rent: 0,
  district: '', city, beds: 3, baths: 2, size: 150, parkings: 0, garden: false, balcony: false,
  view: '', status: 'Available', agentId: 'a1', photos: [], amenities: [], buildingFeatures: [], ...o,
})

test('all three areas survive the round trip', () => {
  const client = dbRowToClient(storedRow(formReq), 0)
  assert.deepEqual(client.req.locations, ['Achrafieh', 'Jounieh', 'Batroun'])
  assert.equal(client.req.location, 'Achrafieh, Jounieh, Batroun')
})

test('and the client then matches a listing in each of them', () => {
  const client = dbRowToClient(storedRow(formReq), 0)
  for (const city of ['Achrafieh', 'Jounieh', 'Batroun']) {
    assert.equal(computeScore(prop(city), client, areas).locationScore, 100, city)
  }
  const inventory = ['Achrafieh', 'Jounieh', 'Batroun', 'Tripoli', 'Saida'].map((c, i) => prop(c, { id: i + 1 }))
  assert.deepEqual(
    matchProperties(client, inventory, MATCH_THRESHOLD, areas).map(m => m.property.city).sort(),
    ['Achrafieh', 'Batroun', 'Jounieh'])
})

test('a client saved before the multi-area field still works', () => {
  // Older rows have only the comma-joined column and no `locations` in the
  // blob. The mapper splits the column so they keep matching every area.
  const old = storedRow(formReq)
  old.notes = JSON.stringify({ agentId: 'NH-1', req: { ...formReq, locations: undefined } })
  const client = dbRowToClient(old, 0)
  assert.deepEqual(client.req.locations, ['Achrafieh', 'Jounieh', 'Batroun'])
  assert.equal(computeScore(prop('Batroun'), client, areas).locationScore, 100)
})

test('the areas are matched through the gazetteer, not by spelling', () => {
  // The whole point: an agent typing Jounieh should match a listing an agent
  // in another office filed as "Jounie".
  const client = dbRowToClient(storedRow(formReq), 0)
  assert.equal(computeScore(prop('Jounie'), client, areas).locationScore, 100)
  assert.equal(computeScore(prop('Ashrafiyeh'), client, areas).locationScore, 100)
  // And a listing filed as "area, city" still lands on the area.
  assert.equal(computeScore(prop('Beirut', { district: 'Achrafieh' }), client, areas).locationScore, 100)
})

test('one area is not thrown away when the rest do not match', () => {
  // The failure this guards against: scoring against locations[0] only.
  const onlyLast = dbRowToClient(storedRow({ ...formReq,
    location: 'Tripoli, Saida, Achrafieh', locations: ['Tripoli', 'Saida', 'Achrafieh'] }), 0)
  assert.equal(computeScore(prop('Achrafieh'), onlyLast, areas).locationScore, 100)
})

test('an area nobody can place does not break the others', () => {
  const messy = dbRowToClient(storedRow({ ...formReq,
    location: 'behind the old mill, Achrafieh', locations: ['behind the old mill', 'Achrafieh'] }), 0)
  assert.equal(computeScore(prop('Achrafieh'), messy, areas).locationScore, 100)
})
