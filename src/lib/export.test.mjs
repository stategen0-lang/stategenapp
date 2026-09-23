// node --experimental-strip-types --test src/lib/export.test.mjs
//
// The export is the other half of the import: whatever an agent can fill in on
// a form has to come back out, or a manager who exports and re-imports quietly
// loses it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { CLIENT_COLUMNS, PROPERTY_COLUMNS } from './export-columns.ts'
import { FIELDS } from './import/mapping.ts'

const property = {
  id: 7, title: 'Sea view apartment', type: 'Appartement', transaction: 'For Sale',
  price: 450000, rent: 0, district: 'Kaslik', city: 'Jounieh', size: 180, beds: 3, baths: 2,
  parkings: 2, buildingAge: 5, floor: 'Mid floor', furnishing: 'Furnished', view: 'Sea',
  garden: false, balcony: true, terrace: true, needsRenovation: false,
  amenities: ['Pool', 'Credit Facilities'], buildingFeatures: ['Elevator', 'Generator'],
  status: 'Available', agentId: 'NH-1', photos: ['a.jpg', 'b.jpg'],
  aiDescription: 'Bright three-bedroom.', aiDescriptionAr: 'شقة مشرقة',
  publicNotes: 'New kitchen', notes: 'owner wants cash',
  ownerName: 'Georges Haddad', ownerContact: '03 987 654',
  mapUrl: 'https://maps.google.com/?q=1,2', referredBy: 'Partner Realty',
}

const client = {
  id: 3, name: 'Rita Aoun', type: 'Buyer', phone: '03 111 222', email: 'r@x.com',
  status: 'Searching', budget: 500000, agentId: 'NH-1', leadScore: 72, agentRating: 4,
  tags: ['VIP', 'cash buyer'], referredByName: 'Partner Realty',
  req: {
    transaction: 'For Sale', type: 'Appartement',
    location: 'Achrafieh, Hamra', locations: ['Achrafieh', 'Hamra'],
    beds: 3, baths: 2, size: 150, parkings: 1, buildingAge: 10,
    floor: 'Mid floor', furnishing: 'Furnished', view: 'Sea',
    garden: false, balcony: true, terrace: false,
    amenities: ['Pool'], buildingFeatures: ['Elevator'], notes: 'wants a quiet street',
  },
}

const row = (cols, rec) => Object.fromEntries(cols.map(c => [c.header, String(c.value(rec) ?? '')]))

test('property export carries every field the form fills in', () => {
  const r = row(PROPERTY_COLUMNS, property)
  assert.equal(r['Parking'], '2')
  assert.equal(r['Building Age'], '5')
  assert.equal(r['Floor'], 'Mid floor')
  assert.equal(r['Furnishing'], 'Furnished')
  assert.equal(r['Terrace'], 'Yes')
  assert.equal(r['Garden'], 'No')
  assert.equal(r['Features'], 'Pool, Credit Facilities')
  assert.equal(r['Building Features'], 'Elevator, Generator')
  assert.equal(r['Description'], 'Bright three-bedroom.')
  assert.equal(r['Description (Arabic)'], 'شقة مشرقة')
  assert.equal(r['Selling Points'], 'New kitchen')
  assert.equal(r['Owner'], 'Georges Haddad')
  assert.equal(r['Photos'], '2')
  assert.equal(r['Area'], 'Jounieh')
})

test('client export carries every area, not just the first', () => {
  const r = row(CLIENT_COLUMNS, client)
  assert.equal(r['Wants'], 'Achrafieh, Hamra')
  assert.equal(r['Property Type'], 'Appartement')
  assert.equal(r['Bathrooms'], '2')
  assert.equal(r['Min Size (m²)'], '150')
  assert.equal(r['Floor'], 'Mid floor')
  assert.equal(r['Must-have Features'], 'Pool')
  assert.equal(r['Building Features'], 'Elevator')
  assert.equal(r['Tags'], 'VIP, cash buyer')
  assert.equal(r['Notes'], 'wants a quiet street')
  assert.equal(r['Referred By'], 'Partner Realty')
})

test('an older record with none of the new fields exports blanks, not "undefined"', () => {
  const bare = { id: 1, title: 'x', type: 'Land', transaction: 'For Sale', price: 0, rent: 0,
    district: '', city: '', size: 0, beds: 0, baths: 0, garden: false, balcony: false,
    view: '', status: 'Available' }
  for (const c of PROPERTY_COLUMNS) {
    const v = String(c.value(bare) ?? '')
    assert.equal(v.includes('undefined'), false, `${c.header} → ${v}`)
    assert.equal(v.includes('null'), false, `${c.header} → ${v}`)
  }
  const bareClient = { id: 1, name: 'x', type: 'Buyer', phone: '', email: '', status: 'Searching',
    budget: 0, req: { transaction: '', type: '', location: '', beds: 0, baths: 0, size: 0, garden: false, balcony: false } }
  for (const c of CLIENT_COLUMNS) {
    const v = String(c.value(bareClient) ?? '')
    assert.equal(v.includes('undefined'), false, `${c.header} → ${v}`)
  }
})

test('no duplicate headers in either export', () => {
  for (const [name, cols] of [['properties', PROPERTY_COLUMNS], ['clients', CLIENT_COLUMNS]]) {
    const headers = cols.map(c => c.header)
    assert.equal(new Set(headers).size, headers.length, `${name} has a repeated header`)
  }
})

test('everything the import can read, the export can write', () => {
  // Not a strict 1:1 — the export also carries computed things (ID, lead score)
  // and the import accepts a reference number the app does not store. But every
  // *listing detail* the importer understands must survive a round trip.
  const exported = PROPERTY_COLUMNS.map(c => c.header.toLowerCase())
  const mustRoundTrip = ['parkings', 'buildingAge', 'floor', 'furnishing', 'view', 'features', 'description', 'publicNotes', 'ownerName', 'mapUrl']
  const labels = Object.fromEntries(FIELDS.properties.map(f => [f.key, f.label]))
  for (const key of mustRoundTrip) {
    assert.ok(labels[key], `import lost the ${key} field`)
  }
  for (const h of ['parking', 'floor', 'furnishing', 'view', 'features', 'description', 'owner', 'map link']) {
    assert.ok(exported.some(e => e.includes(h)), `export has no column for ${h}`)
  }
})
