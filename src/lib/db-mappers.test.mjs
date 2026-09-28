// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/db-mappers.test.mjs
//
// Reading a stored row back into the app's shapes. The spelling of the most
// common property type changed from the French "Appartement" to "Apartment",
// and every listing and client saved before that still holds the old word.
//
// Matching compares the type as an exact string, so getting this wrong does not
// look like a bug — it looks like the agency's whole inventory quietly stopped
// matching anybody.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dbRowToProperty, dbRowToClient, propertyType } from './db-mappers.ts'
import { computeScore } from './matching.ts'
import { loadAreas } from './lebanon/areas.ts'

const areas = await loadAreas()

const listingRow = (type) => ({
  id: 1, Title: 'Sea view flat', Price: 500000, Status: 'Available',
  Location: 'Achrafieh', Bedrooms: 3, bathrooms: 2, size: 150,
  Amenities: JSON.stringify({ agentId: 'NH-1', type, transaction: 'For Sale' }),
})

const clientRow = (type) => ({
  id: 10, 'Client Name': 'Ahmed', budget_max: 500000, bedrooms: 3,
  'prefered-location': 'Achrafieh', payment_terms: 'For Sale',
  notes: JSON.stringify({ agentId: 'NH-1', req: { type, location: 'Achrafieh', beds: 3 } }),
})

test('the old French spelling reads as the English one', () => {
  assert.equal(propertyType('Appartement'), 'Apartment')
  assert.equal(propertyType('appartement'), 'Apartment')
  assert.equal(propertyType('Appartements'), 'Apartment')
  assert.equal(propertyType('Apartment'), 'Apartment')
  // Everything else is passed through untouched.
  assert.equal(propertyType('Villa'), 'Villa')
  assert.equal(propertyType('Land'), 'Land')
  // A listing with no type at all is an apartment, as it always was.
  assert.equal(propertyType(''), 'Apartment')
  assert.equal(propertyType(undefined), 'Apartment')
})

test('a listing saved before the rename still reads as an Apartment', () => {
  assert.equal(dbRowToProperty(listingRow('Appartement'), 0).type, 'Apartment')
  assert.equal(dbRowToProperty(listingRow('Apartment'), 0).type, 'Apartment')
  assert.equal(dbRowToProperty(listingRow('Villa'), 0).type, 'Villa')
})

test('a client who asked for an Appartement still reads as wanting an Apartment', () => {
  assert.equal(dbRowToClient(clientRow('Appartement'), 0).req.type, 'Apartment')
  assert.equal(dbRowToClient(clientRow('Apartment'), 0).req.type, 'Apartment')
  assert.equal(dbRowToClient(clientRow('Villa'), 0).req.type, 'Villa')
  // Nonsense in that field is still ignored, as before — older imports put a
  // transaction here, which hard-excluded every match.
  assert.equal(dbRowToClient(clientRow('For Sale'), 0).req.type, '')
})

test('old and new spellings match each other, in every combination', () => {
  // The point of all of the above: whichever way round the two records were
  // saved, they still find each other.
  for (const listing of ['Appartement', 'Apartment']) {
    for (const wanted of ['Appartement', 'Apartment']) {
      const score = computeScore(
        dbRowToProperty(listingRow(listing), 0),
        dbRowToClient(clientRow(wanted), 0),
        areas)
      assert.equal(score.eligible, true, `${listing} listing vs ${wanted} client`)
      assert.equal(score.total, 100, `${listing} listing vs ${wanted} client`)
    }
  }
})

test('a villa is still not an apartment', () => {
  const score = computeScore(
    dbRowToProperty(listingRow('Villa'), 0),
    dbRowToClient(clientRow('Appartement'), 0),
    areas)
  assert.equal(score.eligible, false)
})
