// Unit tests for putting listings on a map (src/lib/property-geo.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLatLng, propertyPoint, clusterPoints, boundsOf, inLebanon, statusColor } from './property-geo.ts'
import { buildIndex } from './lebanon/areas-core.ts'
import { PACKED_AREAS, GOVERNORATES, CAZAS } from './lebanon/areas.data.ts'

const ix = buildIndex(PACKED_AREAS, GOVERNORATES, CAZAS)

const prop = (o = {}) => ({
  id: o.id ?? 1, title: o.title ?? 'Listing', type: 'Appartement', transaction: 'For Sale',
  price: 300000, rent: 0, district: o.district ?? '', city: o.city ?? 'Achrafieh',
  size: 120, beds: 2, baths: 1, status: o.status ?? 'Available', agentId: 'a1', photos: [],
})

// ── Reading a pin out of a Google Maps link ──────────────────────────────────

test('the shapes agents actually paste', () => {
  // The view centre, which is what Google's "share" button gives.
  assert.deepEqual(parseLatLng('https://www.google.com/maps/@33.8869,35.5131,17z'), { lat: 33.8869, lng: 35.5131 })
  // A place link: the pin (!3d/!4d) is the real location, not the view centre.
  assert.deepEqual(
    parseLatLng('https://www.google.com/maps/place/Achrafieh/@33.88,35.51,15z/data=!4m5!3m4!1s0x0:0x0!8m2!3d33.8912!4d35.5225'),
    { lat: 33.8912, lng: 35.5225 })
  assert.deepEqual(parseLatLng('https://maps.google.com/?q=34.1230,35.6510'), { lat: 34.123, lng: 35.651 })
  assert.deepEqual(parseLatLng('https://maps.google.com/?ll=34.4367,35.8497&z=12'), { lat: 34.4367, lng: 35.8497 })
})

test('a link with nothing usable in it', () => {
  assert.equal(parseLatLng('https://maps.app.goo.gl/AbCdEf123'), null)   // shortened: would need a fetch
  assert.equal(parseLatLng('https://www.google.com/maps/place/Beirut'), null)
  assert.equal(parseLatLng(''), null)
  assert.equal(parseLatLng(null), null)
  assert.equal(parseLatLng(undefined), null)
})

test('coordinates outside Lebanon are a misparse, not a location', () => {
  // Paris. Whatever produced this, it is not a Lebanese listing's pin.
  assert.equal(parseLatLng('https://www.google.com/maps/@48.8566,2.3522,12z'), null)
  assert.ok(inLebanon({ lat: 33.8938, lng: 35.5018 }))     // Beirut
  assert.ok(!inLebanon({ lat: 33.8938, lng: 45.0 }))
})

// ── Where a listing lands ────────────────────────────────────────────────────

test('a pinned listing is placed exactly', () => {
  const point = propertyPoint(prop(), ix, 'https://www.google.com/maps/@33.8912,35.5225,17z')
  assert.ok(point)
  assert.equal(point.exact, true)
  assert.equal(point.lat, 33.8912)
})

test('without a pin it falls back to the centre of its area', () => {
  const point = propertyPoint(prop({ city: 'Achrafieh' }), ix, null)
  assert.ok(point)
  assert.equal(point.exact, false)
  assert.ok(inLebanon(point))
  // Achrafieh is in Beirut, so it should be within a few km of the city.
  assert.ok(Math.abs(point.lat - 33.89) < 0.1, `lat was ${point.lat}`)
})

test('a spelling the gazetteer knows under another name still lands', () => {
  // The whole point of the gazetteer: agents spell this five ways.
  const a = propertyPoint(prop({ city: 'Achrafieh' }), ix, null)
  const b = propertyPoint(prop({ city: 'Ashrafiyeh' }), ix, null)
  assert.ok(a && b)
  assert.equal(a.lat, b.lat)
  assert.equal(a.lng, b.lng)
})

test('the older district column is used when the area field is empty', () => {
  const point = propertyPoint(prop({ city: '', district: 'Jounieh' }), ix, null)
  assert.ok(point)
  assert.equal(point.exact, false)
})

test('an area nobody can place returns null rather than a guess', () => {
  assert.equal(propertyPoint(prop({ city: 'Zzzqqq' }), ix, null), null)
  assert.equal(propertyPoint(prop({ city: '' }), ix, null), null)
  // No gazetteer loaded yet and no pin: nothing to place it by.
  assert.equal(propertyPoint(prop(), null, null), null)
})

// ── Drawing them ─────────────────────────────────────────────────────────────

test('listings on the same spot become one marker', () => {
  const at = (lat, lng, id, exact = false) => ({ lat, lng, property: prop({ id }), exact })
  const clusters = clusterPoints([
    at(33.8869, 35.5131, 1), at(33.8869, 35.5131, 2), at(34.1230, 35.6510, 3),
  ])
  assert.equal(clusters.length, 2)
  const beirut = clusters.find(c => c.lat === 33.8869)
  assert.equal(beirut.properties.length, 2)
  // Heaviest last, so it draws over the pins it overlaps.
  assert.equal(clusters[clusters.length - 1].properties.length, 2)
})

test('a cluster is only "exact" when every listing in it was pinned', () => {
  const at = (id, exact) => ({ lat: 33.8869, lng: 35.5131, property: prop({ id }), exact })
  assert.equal(clusterPoints([at(1, true), at(2, true)])[0].exact, true)
  assert.equal(clusterPoints([at(1, true), at(2, false)])[0].exact, false)
})

test('the box that holds everything', () => {
  assert.deepEqual(
    boundsOf([{ lat: 33.9, lng: 35.5 }, { lat: 34.4, lng: 35.8 }, { lat: 33.5, lng: 35.4 }]),
    { south: 33.5, west: 35.4, north: 34.4, east: 35.8 })
  assert.equal(boundsOf([]), null)
})

test('status decides the colour, and an unknown status reads as available', () => {
  assert.notEqual(statusColor('Sold'), statusColor('Available'))
  assert.equal(statusColor('sold'), statusColor('Sold'))          // case does not matter
  assert.equal(statusColor(undefined), statusColor('Available'))
})
