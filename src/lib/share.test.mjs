// Unit tests for shareable listing links (src/lib/share.ts).
// The signature check and the allowlist are the security-relevant parts.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeShareToken, parseShareToken, publicListing } from './share.ts'

const SECRET = 'test-secret-abc123'

// ── Token round-trip ──────────────────────────────────────────────────────
test('makeShareToken / parseShareToken: round-trips an id', () => {
  for (const id of [1, 7, 42, 9999]) {
    assert.equal(parseShareToken(makeShareToken(id, SECRET), SECRET), id)
  }
})
test('token is URL-safe (no +, /, or =)', () => {
  const t = makeShareToken(12345, SECRET)
  assert.equal(/[+/=]/.test(t), false, t)
})
test('token is not just the id in the clear', () => {
  // "/l/5" must not be guessable — the token must not obviously contain "5".
  const t = makeShareToken(5, SECRET)
  assert.equal(t, makeShareToken(5, SECRET))   // deterministic
  assert.notEqual(t, '5')
})

// ── Forgery is rejected ────────────────────────────────────────────────────
test('a token signed with a different secret is rejected', () => {
  const t = makeShareToken(5, SECRET)
  assert.equal(parseShareToken(t, 'a-different-secret'), null)
})
test('a tampered token is rejected', () => {
  const t = makeShareToken(5, SECRET)
  const tampered = t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a')
  assert.equal(parseShareToken(tampered, SECRET), null)
})
test('a hand-made "id.badsig" token is rejected', () => {
  const forged = Buffer.from('5.0000000000000000', 'utf8').toString('base64url')
  assert.equal(parseShareToken(forged, SECRET), null)
})
test('you cannot swap in a different id under a valid signature', () => {
  // Take id=5's signature and try to pass it off as id=6.
  const t5 = Buffer.from(makeShareToken(5, SECRET).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  const sig = t5.slice(t5.lastIndexOf('.') + 1)
  const swapped = Buffer.from(`6.${sig}`, 'utf8').toString('base64url')
  assert.equal(parseShareToken(swapped, SECRET), null)
})
test('malformed tokens never throw, just return null', () => {
  assert.equal(parseShareToken('', SECRET), null)
  assert.equal(parseShareToken(null, SECRET), null)
  assert.equal(parseShareToken('!!!not base64!!!', SECRET), null)
  assert.equal(parseShareToken(Buffer.from('nodot', 'utf8').toString('base64url'), SECRET), null)
  assert.equal(parseShareToken(Buffer.from('abc.def', 'utf8').toString('base64url'), SECRET), null)   // non-numeric id
  assert.equal(parseShareToken(Buffer.from('-5.x', 'utf8').toString('base64url'), SECRET), null)      // negative id
})

// ── The public allowlist ──────────────────────────────────────────────────
const fullProperty = {
  id: 5, title: 'Raouché Apartment', type: 'Appartement', transaction: 'For Sale',
  price: 480000, rent: 0, district: 'Raouché', city: 'Beirut', size: 145,
  beds: 3, baths: 2, garden: false, balcony: true, view: 'Sea', parkings: 1,
  buildingAge: 8, needsRenovation: true, status: 'Available', agentId: 'a2',
  photos: ['https://x/p1.jpg'],
  // The fields that must never reach a public page:
  notes: 'Owner will drop to 450k, do not tell buyer',
  aiDescription: 'A beautiful sea-view apartment.',
}

test('publicListing: carries the client-facing fields', () => {
  const pub = publicListing(fullProperty, 'A beautiful sea-view apartment.')
  assert.equal(pub.title, 'Raouché Apartment')
  assert.equal(pub.price, 480000)
  assert.equal(pub.beds, 3)
  assert.equal(pub.view, 'Sea')
  assert.deepEqual(pub.photos, ['https://x/p1.jpg'])
  assert.equal(pub.description, 'A beautiful sea-view apartment.')
})
test('publicListing: does NOT carry internal notes', () => {
  const pub = publicListing(fullProperty, 'desc')
  const serialised = JSON.stringify(pub)
  assert.equal(serialised.includes('do not tell buyer'), false)
  assert.equal('notes' in pub, false)
})
test('publicListing: does NOT carry the internal agent code', () => {
  const pub = publicListing(fullProperty, 'desc')
  assert.equal('agentId' in pub, false)
  assert.equal(JSON.stringify(pub).includes('a2'), false)
})
test('publicListing: does NOT carry the internal renovation assessment', () => {
  const pub = publicListing(fullProperty, 'desc')
  assert.equal('needsRenovation' in pub, false)
})
test('publicListing: the exact key set is the allowlist, nothing more', () => {
  const pub = publicListing(fullProperty, 'desc')
  const allowed = new Set([
    'title', 'type', 'transaction', 'price', 'rent', 'district', 'city', 'size',
    'beds', 'baths', 'parkings', 'buildingAge', 'garden', 'balcony', 'terrace',
    'furnishing', 'amenities', 'buildingFeatures', 'view',
    'status', 'photos', 'description',
  ])
  for (const key of Object.keys(pub)) {
    assert.ok(allowed.has(key), `unexpected key leaked to public view: ${key}`)
  }
})
test('publicListing: tolerates a missing photos array', () => {
  const pub = publicListing({ ...fullProperty, photos: undefined }, 'desc')
  assert.deepEqual(pub.photos, [])
})
