// node --experimental-strip-types --test src/lib/listing-stamp.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { propertyStamp, DEFAULT_STAMP } from './listing-stamp.ts'

const flat = (o = {}) => ({ type: 'Appartement', ...o })
const land = (o = {}) => ({ type: 'Land', ...o })

test('stamp: furnished and payment facilities outrank everything else', () => {
  // The agency's two strongest selling points in this market, in that order.
  assert.equal(propertyStamp(flat({ furnishing: 'Furnished', view: 'Sea', amenities: ['Credit Facilities', 'Pool'] })).text, 'Furnished')
  assert.equal(propertyStamp(flat({ view: 'Sea', amenities: ['Credit Facilities', 'Pool'] })).text, 'Payment Facilities')
  assert.equal(propertyStamp(flat({ view: 'Sea', amenities: ['Pool'] })).text, 'Sea View')
})

test('stamp: only fully furnished earns it', () => {
  assert.equal(propertyStamp(flat({ furnishing: 'Semi-furnished', view: 'Sea' })).text, 'Sea View')
  assert.equal(propertyStamp(flat({ furnishing: 'Unfurnished', view: 'Sea' })).text, 'Sea View')
  // Case and spacing from an import or the bot should not matter.
  assert.equal(propertyStamp(flat({ furnishing: 'furnished' })).text, 'Furnished')
})

test('stamp: the rest of the order for a property', () => {
  assert.equal(propertyStamp(flat({ amenities: ['Prime Location'], buildingAge: 0 })).text, 'Prime Location')
  assert.equal(propertyStamp(flat({ buildingAge: 0, amenities: ['Pool'] })).text, 'Brand New')
  assert.equal(propertyStamp(flat({ amenities: ['Pool'], garden: true })).text, 'With Pool')
  assert.equal(propertyStamp(flat({ garden: true, terrace: true })).text, 'Private Garden')
  assert.equal(propertyStamp(flat({ terrace: true })).text, 'Large Terrace')
})

test('stamp: views are read out of free text, however it was typed', () => {
  assert.equal(propertyStamp(flat({ view: 'Open sea view' })).text, 'Sea View')
  assert.equal(propertyStamp(flat({ view: 'SEA' })).text, 'Sea View')
  assert.equal(propertyStamp(flat({ view: 'Panoramic' })).text, 'Panoramic View')
  assert.equal(propertyStamp(flat({ view: 'mountain and valley' })).text, 'Mountain View')
  // Not every view is a selling point.
  assert.equal(propertyStamp(flat({ view: 'Street' })).text, DEFAULT_STAMP.text)
})

test('stamp: land is judged on different things', () => {
  assert.equal(propertyStamp(land({ amenities: ['Flat Land (0% slope)'], view: 'Sea' })).text, 'Flat Land · 0% Slope')
  assert.equal(propertyStamp(land({ amenities: ['Building Permit'], view: 'Sea' })).text, 'Building Permit')
  assert.equal(propertyStamp(land({ view: 'Sea', amenities: ['Credit Facilities'] })).text, 'Sea View')
  // Furniture means nothing on a plot, even if someone ticked it.
  assert.equal(propertyStamp(land({ furnishing: 'Furnished', view: 'Sea' })).text, 'Sea View')
  // And a flat is never stamped with a plot's virtues.
  assert.equal(propertyStamp(flat({ amenities: ['Flat Land (0% slope)'] })).text, DEFAULT_STAMP.text)
})

test('stamp: a listing with nothing remarkable still gets a true one', () => {
  assert.deepEqual(propertyStamp(flat()), DEFAULT_STAMP)
  assert.deepEqual(propertyStamp({}), DEFAULT_STAMP)
  assert.deepEqual(propertyStamp(flat({ amenities: [], view: '', furnishing: '' })), DEFAULT_STAMP)
})

test('stamp: always has both languages, short enough to be a badge', () => {
  const cases = [
    flat({ furnishing: 'Furnished' }), flat({ amenities: ['Credit Facilities'] }),
    flat({ view: 'Sea' }), flat({ amenities: ['Prime Location'] }), flat({ buildingAge: 0 }),
    land({ amenities: ['Flat Land (0% slope)'] }), flat(),
  ]
  for (const c of cases) {
    const s = propertyStamp(c)
    assert.ok(s.text && s.text.length <= 22, `too long: ${s.text}`)
    assert.ok(/[؀-ۿ]/.test(s.ar), `no Arabic for ${s.text}`)
  }
})
