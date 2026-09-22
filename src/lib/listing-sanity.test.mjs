// node --experimental-strip-types --test src/lib/listing-sanity.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { listingWarnings } from './listing-sanity.ts'

test('warns when the title says land but the type does not', () => {
  // The real one: "Land plot" in Batroun, saved as an Appartement because the
  // form starts there, and then invisible to every client wanting land.
  const [w] = listingWarnings({ title: 'Land plot', type: 'Appartement', beds: 0, baths: 0 })
  assert.equal(w.field, 'type')
  assert.match(w.text, /title says land/i)
  assert.match(w.text, /Appartement/)
  for (const title of ['1700 m2 plot in Batroun', 'Terrain à Batroun', 'Nice LOT for sale', 'ard for sale']) {
    assert.equal(listingWarnings({ title, type: 'Villa', beds: 3, baths: 2 }).length, 1, title)
  }
})

test('warns when a home has no bedroom and no bathroom', () => {
  const [w] = listingWarnings({ title: '1700 m² in Batroun', type: 'Appartement', beds: 0, baths: 0 })
  assert.match(w.text, /No bedrooms and no bathrooms/)
  assert.match(w.text, /an appartement/)
  assert.match(listingWarnings({ title: 'x', type: 'Villa', beds: 0, baths: 0 })[0].text, /a villa/)
})

test('stays quiet when the listing makes sense', () => {
  assert.deepEqual(listingWarnings({ title: 'Land plot', type: 'Land', beds: 0, baths: 0 }), [])
  assert.deepEqual(listingWarnings({ title: '3 bedroom in Achrafieh', type: 'Appartement', beds: 3, baths: 2 }), [])
  assert.deepEqual(listingWarnings({ title: 'Shop in Hamra', type: 'Shop', beds: 0, baths: 0 }), [])
  assert.deepEqual(listingWarnings({ title: 'Warehouse', type: 'Warehouse', beds: 0, baths: 0 }), [])
  // A studio with one bathroom and no separate bedroom is normal.
  assert.deepEqual(listingWarnings({ title: 'Studio', type: 'Studio', beds: 0, baths: 1 }), [])
})

test('does not trip over a word that merely contains "land"', () => {
  assert.deepEqual(listingWarnings({ title: 'Highland Towers, Achrafieh', type: 'Appartement', beds: 2, baths: 2 }), [])
  assert.deepEqual(listingWarnings({ title: 'Sunland Residence', type: 'Appartement', beds: 2, baths: 2 }), [])
})

test('"lot" warns even when it means a building number — accepted', () => {
  // Plots here are routinely called "lot 234", so the word is worth catching.
  // The cost is an occasional nudge on "Flat in Lot 5", which an agent ignores.
  assert.equal(listingWarnings({ title: 'Flat in Lot 5 building', type: 'Appartement', beds: 2, baths: 1 }).length, 1)
})

test('survives a half-filled form', () => {
  assert.deepEqual(listingWarnings({}), [])
  assert.deepEqual(listingWarnings({ title: '', type: '', beds: '', baths: '' }), [])
  assert.equal(listingWarnings({ title: 'Land', type: 'Appartement', beds: '', baths: '' }).length, 1)
})
