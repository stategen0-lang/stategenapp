// Unit tests for sorting WhatsApp listing features into form fields. Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortListingFeatures, extractFeaturesFromNotes, mergeFeatureFields, LISTING_AMENITIES, LISTING_LAND_AMENITIES, LISTING_BUILDING_FEATURES } from './listing-features.ts'
import { PROPERTY_AMENITIES, LAND_AMENITIES, BUILDING_FEATURES } from '../data.ts'

test('checkbox names stay in sync with the web form', () => {
  assert.deepEqual([...LISTING_AMENITIES], PROPERTY_AMENITIES)
  assert.deepEqual([...LISTING_LAND_AMENITIES], LAND_AMENITIES)
  assert.deepEqual([...LISTING_BUILDING_FEATURES], BUILDING_FEATURES)
})

test('the reported message: mid floor, heating system, parking, view', () => {
  const { fields, unmatched } = sortListingFeatures('mid floor, heating system, parking, sea view')
  assert.equal(fields.floor, 'Mid floor')
  assert.equal(fields.parkings, 1)
  assert.equal(fields.view, 'Sea')
  assert.deepEqual(unmatched, ['heating system'])       // no checkbox → notes
})

test('building features and amenities tick the right boxes', () => {
  const { fields, unmatched } = sortListingFeatures(['lift', '24/7 electricity', "maid's room", 'A/C', 'shared pool', 'private pool', 'natour', 'gym', 'storage room', 'solar panels', 'water well', 'security'])
  assert.deepEqual(fields.buildingFeatures?.sort(), ['24/7 Security', 'Concierge', 'Elevator', 'Generator', 'Gym', 'Shared Pool', 'Solar Panels', 'Storage Room', 'Water Well'])
  assert.deepEqual(fields.amenities?.sort(), ['Air Conditioning', "Helper's Room", 'Pool'])
  assert.deepEqual(unmatched, [])
})

test('outdoor, condition, furnishing and parking counts', () => {
  const { fields } = sortListingFeatures('garden, balcony, terrace, needs renovation, semi furnished, 2 parkings')
  assert.equal(fields.garden, true)
  assert.equal(fields.balcony, true)
  assert.equal(fields.terrace, true)
  assert.equal(fields.needsRenovation, true)
  assert.equal(fields.furnishing, 'Semi-furnished')
  assert.equal(fields.parkings, 2)
})

test('filler words around a feature are ignored', () => {
  const { fields, unmatched } = sortListingFeatures(['with elevator', 'has a generator', 'parking included', 'fully furnished'])
  assert.deepEqual(fields.buildingFeatures, ['Elevator', 'Generator'])
  assert.equal(fields.parkings, 1)
  assert.equal(fields.furnishing, 'Furnished')
  assert.deepEqual(unmatched, [])
})

test('a negated feature is never ticked — it stays as a note', () => {
  const { fields, unmatched } = sortListingFeatures(['no elevator', 'without parking', 'ma fi generator'])
  assert.equal(fields.buildingFeatures, undefined)
  assert.equal(fields.parkings, undefined)
  assert.deepEqual(unmatched, ['no elevator', 'without parking', 'ma fi generator'])
  // …but "unfurnished" / "not furnished" are real answers, not negations.
  assert.equal(sortListingFeatures('not furnished').fields.furnishing, 'Unfurnished')
  assert.equal(sortListingFeatures('unfurnished').fields.furnishing, 'Unfurnished')
})

test('extractFeaturesFromNotes: moves only clauses that are just features', () => {
  const r = extractFeaturesFromNotes('Mid floor, generator and elevator, heating system, owner wants cash only. Sea view')
  assert.equal(r.fields.floor, 'Mid floor')
  assert.deepEqual(r.fields.buildingFeatures, ['Generator', 'Elevator'])
  assert.equal(r.fields.view, 'Sea')
  assert.equal(r.notes, 'heating system, owner wants cash only')
})

test('extractFeaturesFromNotes: a mixed clause is left alone', () => {
  const r = extractFeaturesFromNotes('elevator broken since March')
  assert.deepEqual(r.fields, {})
  assert.equal(r.notes, 'elevator broken since March')
})

test('mergeFeatureFields: stated values win, checkbox lists union', () => {
  const out = mergeFeatureFields(
    { floor: 'Last floor', buildingFeatures: ['Elevator'] },
    { floor: 'Mid floor', buildingFeatures: ['Generator', 'Elevator'], garden: true },
  )
  assert.equal(out.floor, 'Last floor')
  assert.deepEqual(out.buildingFeatures, ['Elevator', 'Generator'])
  assert.equal(out.garden, true)
})
