// node --experimental-strip-types --test src/lib/property-payload.test.mjs
//
// The point of the first test: Public Notes was on the form, shown on screen,
// and fed to the AI description — but missing from the payload, so it was never
// stored and was gone the next time the listing was opened. Nothing failed.
// This walks the form's own fields so the next one cannot be forgotten.

import test from 'node:test'
import assert from 'node:assert/strict'
import { propertyPayload } from './property-payload.ts'

// Every field the form holds, all filled in, so nothing is skipped for being
// empty. Keep this in step with the form's useState — that is the whole job.
const FORM = {
  title: 'Sea view apartment',
  type: 'Appartement',
  transaction: 'For Sale',
  price: '450000',
  rent: '0',
  area: 'Achrafieh',
  size: '180',
  beds: '3',
  baths: '2',
  parkings: '2',
  buildingAge: '5',
  floor: 'Mid floor',
  needsRenovation: true,
  garden: true,
  balcony: true,
  terrace: true,
  furnishing: 'Furnished',
  view: 'Sea',
  mapUrl: 'https://maps.google.com/?q=1,2',
  video: 'https://x/v.mp4',
  status: 'Available',
  advancedPayment: '3 months',
  aiDescription: 'Bright three-bedroom.',
  aiDescriptionAr: 'شقة مشرقة',
  notes: 'owner wants cash',
  publicNotes: 'New kitchen, quiet street',
  referredBy: 'Partner Realty',
  ownerName: 'Georges Haddad',
  ownerContact: '03 987 654',
}

const EXTRAS = {
  agentId: 'NH-1',
  amenities: ['Pool'],
  buildingFeatures: ['Elevator'],
  photos: ['a.jpg'],
  documentPath: 'company-1/deed.pdf',
  documentName: 'deed.pdf',
}

test('every field on the form reaches the payload', () => {
  const payload = propertyPayload(FORM, EXTRAS)
  for (const key of Object.keys(FORM)) {
    // "area" is the one deliberate rename: it is stored as district + city.
    if (key === 'area') continue
    assert.ok(key in payload, `${key} is on the form but never sent — it will not be saved`)
  }
  assert.equal(payload.city, 'Achrafieh')
  assert.equal(payload.district, '')
})

test('public notes are sent', () => {
  // The reported bug, pinned on its own.
  assert.equal(propertyPayload(FORM, EXTRAS).publicNotes, 'New kitchen, quiet street')
  // And the internal notes stay separate.
  assert.equal(propertyPayload(FORM, EXTRAS).notes, 'owner wants cash')
})

test('numbers arrive as numbers, blanks as undefined', () => {
  const p = propertyPayload(FORM, EXTRAS)
  assert.equal(p.price, 450000)
  assert.equal(p.size, 180)
  assert.equal(p.beds, 3)
  assert.equal(p.parkings, 2)

  const empty = propertyPayload({ ...FORM, price: '', size: '', parkings: '', buildingAge: '' }, EXTRAS)
  assert.equal(empty.price, 0)        // a price of nothing is zero, not absent
  assert.equal(empty.size, 0)
  assert.equal(empty.parkings, undefined)   // optional: absent rather than 0
  assert.equal(empty.buildingAge, undefined)
})

test('an empty text field is sent as undefined, not an empty string', () => {
  const p = propertyPayload(
    { ...FORM, publicNotes: '', notes: '', mapUrl: '  ', referredBy: '', ownerName: '', aiDescriptionAr: '' },
    EXTRAS)
  for (const k of ['publicNotes', 'notes', 'mapUrl', 'referredBy', 'ownerName', 'aiDescriptionAr']) {
    assert.equal(p[k], undefined, k)
  }
})

test('an advance is only sent for a rental', () => {
  assert.equal(propertyPayload(FORM, EXTRAS).advancedPayment, undefined)   // For Sale
  const rental = propertyPayload({ ...FORM, transaction: 'For Rent' }, EXTRAS)
  assert.equal(rental.advancedPayment, '3 months')
  assert.equal(propertyPayload({ ...FORM, transaction: 'For Rent', advancedPayment: '' }, EXTRAS).advancedPayment, undefined)
})

test('photos and the document come from outside the form', () => {
  const p = propertyPayload(FORM, EXTRAS)
  assert.deepEqual(p.photos, ['a.jpg'])
  assert.deepEqual(p.amenities, ['Pool'])
  assert.deepEqual(p.buildingFeatures, ['Elevator'])
  assert.equal(p.documentName, 'deed.pdf')
  assert.equal(p.agentId, 'NH-1')
  // No photos means the key is absent, so a save never blanks an existing set.
  assert.equal(propertyPayload(FORM, { ...EXTRAS, photos: [] }).photos, undefined)
})

test('the area is trimmed on the way out', () => {
  assert.equal(propertyPayload({ ...FORM, area: '  Achrafieh  ' }, EXTRAS).city, 'Achrafieh')
})
