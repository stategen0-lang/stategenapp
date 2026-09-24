// node --experimental-strip-types --test src/lib/lebanon/learned-areas.test.mjs
//
// Places an agency teaches the app by dropping a pin. The point of these tests:
// a learned area has to behave like a built-in one — suggested, corrected to,
// and used by matching — without being able to damage the built-in ones.

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIndex, extendIndex, resolveArea, searchAreas, distanceKm } from './areas-core.ts'
import { PACKED_AREAS, GOVERNORATES, CAZAS } from './areas.data.ts'
import {
  checkPin, alreadyKnown, nearestArea, areaFromPin, learnedAreas, pinInLebanon, MAX_NAME,
} from './learned-areas.ts'

const base = buildIndex(PACKED_AREAS, GOVERNORATES, CAZAS)

// Somewhere in Aley caza, which is where the agency says Hbous is.
const ALEY = { lat: 33.8100, lng: 35.6000 }

// ── The pin itself ───────────────────────────────────────────────────────────

test('a pin needs a name and a point inside Lebanon', () => {
  assert.equal(checkPin('Hbous', ALEY.lat, ALEY.lng).ok, true)
  assert.equal(checkPin('', ALEY.lat, ALEY.lng).ok, false)
  assert.equal(checkPin('H', ALEY.lat, ALEY.lng).ok, false)
  assert.equal(checkPin('123 ...', ALEY.lat, ALEY.lng).ok, false)
  assert.equal(checkPin('x'.repeat(MAX_NAME + 1), ALEY.lat, ALEY.lng).ok, false)
  // Paris.
  assert.equal(checkPin('Hbous', 48.8566, 2.3522).ok, false)
  assert.equal(checkPin('Hbous', 'nonsense', ALEY.lng).ok, false)
  assert.ok(!pinInLebanon(NaN, NaN))
})

test('a name is tidied, not rejected, for spacing', () => {
  const r = checkPin('  Hbous   el  Aaley ', ALEY.lat, ALEY.lng)
  assert.equal(r.ok, true)
  assert.equal(r.name, 'Hbous el Aaley')
})

test('an Arabic name is a name', () => {
  assert.equal(checkPin('حبوس', ALEY.lat, ALEY.lng).ok, true)
})

// ── Not re-teaching what we know ─────────────────────────────────────────────

test('a place the gazetteer already corrects to is refused', () => {
  // The whole point of the gazetteer is that these are ONE area.
  assert.equal(alreadyKnown(base, 'Achrafieh')?.name, 'Achrafieh')
  assert.equal(alreadyKnown(base, 'Ashrafiyeh')?.name, 'Achrafieh')
  assert.equal(alreadyKnown(base, 'Jounieh')?.name, 'Jounieh')
  // But a place it only half-recognises is fair game — that is the case that
  // sent "Hbous" to Habbouch.
  assert.equal(alreadyKnown(base, 'Hbous'), null)
})

// ── Filling in the rest from the pin ─────────────────────────────────────────

test('the caza is read off the nearest place we already know', () => {
  const near = nearestArea(base, ALEY.lat, ALEY.lng)
  assert.ok(near, 'somewhere must be nearest')
  const learned = areaFromPin(base, 'Hbous', ALEY.lat, ALEY.lng)
  assert.equal(learned.name, 'Hbous')
  assert.equal(learned.caza, near.caza)
  assert.equal(learned.governorate, near.governorate)
  assert.ok(learned.caza, 'a pin must come out with a caza')
})

test('a pin in Beirut gets Beirut, a pin in the north does not', () => {
  assert.equal(areaFromPin(base, 'Somewhere', 33.8938, 35.5018).governorate, 'Beirut')
  const north = areaFromPin(base, 'Somewhere', 34.4367, 35.8497)   // Tripoli
  assert.notEqual(north.governorate, 'Beirut')
})

// ── Behaving like a real area ────────────────────────────────────────────────

const HBOUS = [{ name: 'Hbous', lat: ALEY.lat, lng: ALEY.lng, caza: 'Aley', governorate: 'Mount Lebanon' }]

test('once taught, it resolves — and confidently, so it is corrected to', () => {
  const ix = extendIndex(base, learnedAreas(HBOUS))
  const r = resolveArea(ix, 'Hbous')
  assert.equal(r?.area.name, 'Hbous')
  assert.equal(r.confident, true, 'a taught place must be corrected to, like any other')
  assert.equal(r.area.caza, 'Aley')
  // And the spellings of it fold together, which is the point.
  assert.equal(resolveArea(ix, 'hbous')?.area.name, 'Hbous')
  assert.equal(resolveArea(ix, 'HBOUS')?.area.name, 'Hbous')
})

test('it is offered in the suggestion list as you type', () => {
  const ix = extendIndex(base, learnedAreas(HBOUS))
  // "Hbou", not "Hbo": folding turns the pair "ou" into "u", so a prefix is
  // only comparable once both letters are typed. That is true of every area,
  // built-in ones included.
  assert.ok(searchAreas(ix, 'Hbou', 8).some(a => a.name === 'Hbous'))
  assert.ok(searchAreas(ix, 'Hbous', 8).some(a => a.name === 'Hbous'))
  // And it is not offered to an agency that never taught it.
  assert.ok(!searchAreas(base, 'Hbous', 8).some(a => a.name === 'Hbous'))
})

test('it has real coordinates, so matching can measure distance to it', () => {
  const ix = extendIndex(base, learnedAreas(HBOUS))
  const hbous = resolveArea(ix, 'Hbous').area
  const aley = resolveArea(ix, 'Aley').area
  const km = distanceKm(hbous, aley)
  assert.ok(km > 0 && km < 30, `Hbous should sit near Aley, got ${km} km`)
})

// ── Not damaging what was already there ──────────────────────────────────────

test('teaching one agency a place leaves the shared gazetteer untouched', () => {
  const beforeAreas = base.areas.length
  const beforeFold = base.byFold.get('hbus')?.length ?? 0
  const ix = extendIndex(base, learnedAreas(HBOUS))

  assert.equal(ix.areas.length, beforeAreas + 1)
  // The shared index must not have grown — another agency still knows nothing
  // of Hbous.
  assert.equal(base.areas.length, beforeAreas)
  assert.equal(base.byFold.get('hbus')?.length ?? 0, beforeFold)
  assert.equal(resolveArea(base, 'Hbous')?.area.name !== 'Hbous', true)
})

test('a learned area cannot take a built-in one over', () => {
  // An agency that pins its own "Achrafieh" must not break everyone's.
  const ix = extendIndex(base, learnedAreas([
    { name: 'Achrafieh', lat: 34.0, lng: 36.0, caza: 'Zahle', governorate: 'Beqaa' },
  ]))
  const r = resolveArea(ix, 'Achrafieh')
  // Two places now answer to the name, so it is ambiguous rather than moved.
  assert.equal(r.candidates.length > 1, true)
  assert.equal(r.candidates.some(a => a.caza === 'Beirut'), true)
})

test('rubbish rows are dropped, not trusted', () => {
  const areas = learnedAreas([
    { name: 'Hbous', lat: ALEY.lat, lng: ALEY.lng },
    { name: '', lat: ALEY.lat, lng: ALEY.lng },              // no name
    { name: 'Paris', lat: 48.8566, lng: 2.3522 },            // not in Lebanon
    { name: 'Hbous', lat: 33.9, lng: 35.6 },                 // the same name twice
    { name: 'Nowhere', lat: null, lng: undefined },
  ])
  assert.deepEqual(areas.map(a => a.name), ['Hbous'])
})

test('extending by nothing returns the very same index', () => {
  assert.equal(extendIndex(base, []), base)
})
