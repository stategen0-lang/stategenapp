// node --experimental-strip-types --test src/lib/maps-link.test.mjs
//
// Reading a place out of whatever an agent pastes. The list below is the point
// of the module: these are the shapes Google actually hands out, from the phone
// app and from the desktop site.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLatLng, readMapsPaste, allowedMapsHost, isShortLink, inLebanon } from './maps-link.ts'

test('the desktop link: the view centre', () => {
  assert.deepEqual(parseLatLng('https://www.google.com/maps/@33.8869,35.5131,17z'), { lat: 33.8869, lng: 35.5131 })
})

test('the pin beats the view it was shown in', () => {
  // @33.80 is where the map was looking; !3d/!4d is the place itself.
  const url = 'https://www.google.com/maps/place/Aley/@33.8000,35.6000,14z/data=!4m6!3m5!1s0x0:0x0!8m2!3d33.8102!4d35.6011'
  assert.deepEqual(parseLatLng(url), { lat: 33.8102, lng: 35.6011 })
})

test('the other query shapes', () => {
  assert.deepEqual(parseLatLng('https://maps.google.com/?q=34.1230,35.6510'), { lat: 34.123, lng: 35.651 })
  assert.deepEqual(parseLatLng('https://maps.google.com/?ll=34.4367,35.8497&z=12'), { lat: 34.4367, lng: 35.8497 })
  assert.deepEqual(parseLatLng('https://www.google.com/maps/search/33.8938,35.5018'), { lat: 33.8938, lng: 35.5018 })
})

test('a coordinate pair copied straight out of the app', () => {
  // Long-press a spot in Google Maps and it offers the numbers to copy.
  assert.deepEqual(parseLatLng('33.8102, 35.6011'), { lat: 33.8102, lng: 35.6011 })
  assert.deepEqual(parseLatLng('33.8102 35.6011'), { lat: 33.8102, lng: 35.6011 })
  assert.deepEqual(parseLatLng('  33.8102,35.6011  '), { lat: 33.8102, lng: 35.6011 })
})

test('coordinates outside Lebanon are not a Lebanese listing', () => {
  assert.equal(parseLatLng('https://www.google.com/maps/@48.8566,2.3522,12z'), null)   // Paris
  assert.equal(parseLatLng('48.8566, 2.3522'), null)
  assert.ok(inLebanon({ lat: 33.8938, lng: 35.5018 }))
  assert.ok(!inLebanon({ lat: NaN, lng: 35.5 }))
})

test('nothing at all', () => {
  assert.equal(parseLatLng(''), null)
  assert.equal(parseLatLng(null), null)
  assert.equal(parseLatLng('Hbous'), null)
  assert.equal(parseLatLng('https://www.google.com/maps/place/Beirut'), null)
})

// ── What may be fetched ──────────────────────────────────────────────────────

test('only Google hosts may be followed', () => {
  assert.ok(allowedMapsHost('https://maps.app.goo.gl/x7Yk'))
  assert.ok(allowedMapsHost('https://www.google.com/maps/place/Aley'))
  assert.ok(allowedMapsHost('https://www.google.com.lb/maps'))
  assert.ok(allowedMapsHost('https://google.fr/maps'))
  // Anything else, including things that merely look the part.
  assert.ok(!allowedMapsHost('https://evil.com/maps'))
  assert.ok(!allowedMapsHost('https://google.com.evil.com/maps'))
  assert.ok(!allowedMapsHost('https://notgoogle.com/maps'))
  assert.ok(!allowedMapsHost('http://169.254.169.254/latest/meta-data/'))
  assert.ok(!allowedMapsHost('file:///etc/passwd'))
  assert.ok(!allowedMapsHost('not a url'))
})

test('which links have to be followed', () => {
  assert.ok(isShortLink('https://maps.app.goo.gl/x7YkQ2'))
  assert.ok(isShortLink('https://goo.gl/maps/abc'))
  assert.ok(!isShortLink('https://www.google.com/maps/@33.8,35.5,17z'))
  assert.ok(!isShortLink('nonsense'))
})

// ── The decision made before anything is fetched ─────────────────────────────

test('a link we can read needs no request', () => {
  const v = readMapsPaste('https://www.google.com/maps/@33.8869,35.5131,17z')
  assert.equal(v.kind, 'point')
  assert.deepEqual(v.point, { lat: 33.8869, lng: 35.5131 })
})

test('the phone Share link is followed', () => {
  const v = readMapsPaste('https://maps.app.goo.gl/x7YkQ2')
  assert.equal(v.kind, 'expand')
  assert.equal(v.url, 'https://maps.app.goo.gl/x7YkQ2')
})

test('everything else is refused, with the fix in the message', () => {
  for (const [input, wanted] of [
    ['', /Paste a Google Maps link/],
    ['Hbous', /does not look like a link/],
    ['https://evil.com/maps/@33.8,35.5,17z', /Only Google Maps links/],
    ['https://www.google.com/maps/place/Beirut', /no location in it/],
  ]) {
    const v = readMapsPaste(input)
    assert.equal(v.kind, 'error', input)
    assert.match(v.error, wanted, input)
  }
})

test('a place outside Lebanon says so, rather than "no location"', () => {
  // It parsed perfectly well — the agent shared the wrong place, and being told
  // the link is broken would send them hunting for the wrong problem.
  const v = readMapsPaste('https://www.google.com/maps/@48.8566,2.3522,12z')
  assert.equal(v.kind, 'error')
  assert.match(v.error, /outside Lebanon/)
  assert.match(readMapsPaste('48.8566, 2.3522').error, /outside Lebanon/)
})
