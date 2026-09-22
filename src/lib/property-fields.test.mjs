// node --experimental-strip-types --test src/lib/property-fields.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldsFor, hasField, clearedByTypeChange, fieldLabel } from './property-fields.ts'
import { PROPERTY_TYPES, amenitiesFor } from './data.ts'

test('land is asked for its size and its view, and nothing else', () => {
  assert.deepEqual(fieldsFor('Land').sort(), ['size', 'view'])
  for (const f of ['beds', 'baths', 'balcony', 'garden', 'terrace', 'furnishing', 'floor', 'buildingAge', 'buildingFeatures', 'parkings']) {
    assert.equal(hasField('Land', f), false, `Land should not have ${f}`)
  }
})

test('a shop has a toilet and a floor, never a bedroom or a garden', () => {
  for (const type of ['Shop', 'Office', 'Showroom', 'Restaurant']) {
    assert.equal(hasField(type, 'baths'), true, type)
    assert.equal(hasField(type, 'floor'), true, type)
    assert.equal(hasField(type, 'furnishing'), true, `${type} can be let furnished`)
    assert.equal(hasField(type, 'beds'), false, type)
    assert.equal(hasField(type, 'garden'), false, type)
    assert.equal(hasField(type, 'balcony'), false, type)
  }
})

test('storage and parking have nothing to furnish', () => {
  assert.equal(hasField('Warehouse', 'furnishing'), false)
  assert.equal(hasField('Warehouse', 'baths'), true)
  assert.equal(hasField('Garage', 'baths'), false)
  assert.equal(hasField('Garage', 'beds'), false)
  assert.equal(hasField('Garage', 'furnishing'), false)
})

test('a whole building has no single floor and nobody furnishes it', () => {
  assert.equal(hasField('Building', 'floor'), false)
  assert.equal(hasField('Building', 'furnishing'), false)
  assert.equal(hasField('Building', 'beds'), false)
  assert.equal(hasField('Building', 'buildingAge'), true)
  assert.equal(hasField('Building', 'parkings'), true)
  assert.equal(hasField('Building', 'buildingFeatures'), true)
})

test('homes keep everything, and an unknown type is treated as one', () => {
  for (const type of ['Appartement', 'Duplex', 'Studio', 'Villa', 'Chalet', 'Standalone']) {
    for (const f of ['beds', 'baths', 'balcony', 'garden', 'furnishing', 'floor']) {
      assert.equal(hasField(type, f), true, `${type} should have ${f}`)
    }
  }
  assert.equal(hasField('Something New', 'beds'), true)
  assert.equal(hasField(undefined, 'beds'), true)
  assert.equal(hasField(null, 'beds'), true)
})

test('every type in the picker has a field list, and size is always asked', () => {
  for (const type of PROPERTY_TYPES) {
    assert.ok(fieldsFor(type).length > 0, type)
    assert.equal(hasField(type, 'size'), true, `${type} should be asked for its size`)
  }
})

test('changing type clears what no longer applies, and reports what it cleared', () => {
  const apartment = {
    size: '180', beds: '3', baths: '2', parkings: '1', buildingAge: '5',
    floor: 'Mid floor', needsRenovation: true, garden: true, balcony: true,
    terrace: true, furnishing: 'Furnished', view: 'Sea', buildingFeatures: ['Elevator'],
  }
  const cleared = clearedByTypeChange('Land', apartment)
  assert.equal(cleared.beds, '')
  assert.equal(cleared.baths, '')
  assert.equal(cleared.garden, false)
  assert.equal(cleared.balcony, false)
  assert.equal(cleared.furnishing, '')
  assert.deepEqual(cleared.buildingFeatures, [])
  // The two that land does keep are untouched.
  assert.equal('size' in cleared, false)
  assert.equal('view' in cleared, false)
})

test('changing type reports nothing when there is nothing to clear', () => {
  assert.deepEqual(clearedByTypeChange('Land', { size: '1700', view: 'Sea' }), {})
  assert.deepEqual(clearedByTypeChange('Land', { beds: '', baths: '', garden: false }), {})
  assert.deepEqual(clearedByTypeChange('Land', { beds: 0, baths: '0' }), {})
  assert.deepEqual(clearedByTypeChange('Land', {}), {})
  // Going the other way adds fields back; it never has anything to clear.
  assert.deepEqual(clearedByTypeChange('Appartement', { beds: '3', garden: true }), {})
})

test('amenities follow the type too', () => {
  const land = amenitiesFor('Land')
  assert.ok(land.includes('Flat Land (0% slope)'))
  assert.ok(land.includes('Credit Facilities'))
  assert.equal(land.includes('Pool'), false)
  assert.equal(land.includes("Helper's Room"), false)

  const shop = amenitiesFor('Shop')
  assert.ok(shop.includes('Air Conditioning'))
  assert.equal(shop.includes("Helper's Room"), false)
  assert.equal(shop.includes('Pool'), false)

  assert.ok(amenitiesFor('Appartement').includes('Pool'))
  assert.equal(amenitiesFor('Garage').includes('Air Conditioning'), false)
})

test('fieldLabel says it the way an agent would', () => {
  assert.equal(fieldLabel('beds'), 'bedrooms')
  assert.equal(fieldLabel('buildingFeatures'), 'building features')
  assert.equal(fieldLabel('somethingElse'), 'somethingElse')
})
