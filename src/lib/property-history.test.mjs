// node --experimental-strip-types --test src/lib/property-history.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { propertyChanges } from './property-history.ts'

const snap = (o = {}) => ({ price: 500000, status: 'Available', isRent: false, ...o })

test('records a price move, both directions', () => {
  assert.deepEqual(propertyChanges(snap(), snap({ price: 450000 })),
    [{ field: 'price', old: '500000', new: '450000' }])
  assert.deepEqual(propertyChanges(snap(), snap({ price: 600000 })),
    [{ field: 'price', old: '500000', new: '600000' }])
})

test("a rental's figure is recorded as rent, so the feed can say /mo", () => {
  const [c] = propertyChanges(snap({ price: 1200, isRent: true }), snap({ price: 1000, isRent: true }))
  assert.equal(c.field, 'rent')
})

test('records a status move', () => {
  assert.deepEqual(propertyChanges(snap(), snap({ status: 'Sold' })),
    [{ field: 'status', old: 'Available', new: 'Sold' }])
})

test('both at once, price first', () => {
  const cs = propertyChanges(snap(), snap({ price: 400000, status: 'Reserved' }))
  assert.equal(cs.length, 2)
  assert.equal(cs[0].field, 'price')
  assert.equal(cs[1].field, 'status')
})

test('a price appearing for the first time is not a price change', () => {
  // The listing is being completed, not repriced — calling that a rise is a lie.
  assert.deepEqual(propertyChanges(snap({ price: 0 }), snap({ price: 250000 })), [])
  assert.deepEqual(propertyChanges(snap(), snap({ price: 0 })), [])
})

test('an edit that touches neither records nothing', () => {
  assert.deepEqual(propertyChanges(snap(), snap()), [])
  assert.deepEqual(propertyChanges(snap(), snap({ status: '' })), [])
  // Same number written differently is still the same number.
  assert.deepEqual(propertyChanges(snap({ price: 500000 }), snap({ price: '500000' })), [])
  assert.deepEqual(propertyChanges(snap({ status: 'Available' }), snap({ status: ' Available ' })), [])
})

test('survives rubbish without throwing', () => {
  assert.deepEqual(propertyChanges(snap({ price: NaN }), snap({ price: NaN })), [])
  assert.deepEqual(propertyChanges({ price: undefined, status: undefined, isRent: false }, snap()),
    [{ field: 'status', old: '', new: 'Available' }])
})
