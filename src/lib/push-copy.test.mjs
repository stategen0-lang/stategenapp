// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/push-copy.test.mjs
//
// What a phone notification says. These reach a lock screen, so two things are
// being guarded: that an agent can act on one at a glance, and that the one
// going to somebody else's agent never carries a client's name.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newListingPush, priceDropPush, newClientPush } from './push-copy.ts'

test('a new listing names the client, because the client is yours', () => {
  const n = newListingPush({ listingTitle: '210 m² Apartment in Geitawi', clientName: 'Charbel Salameh', score: 87.4, propertyId: 182 })
  assert.equal(n.title, 'New listing matches your client')
  assert.match(n.body, /210 m² Apartment in Geitawi/)
  assert.match(n.body, /87% match/)
  assert.match(n.body, /Charbel Salameh/)
  assert.equal(n.url, '/properties?open=182')
})

test('a price drop shows the move, not just that there was one', () => {
  const n = priceDropPush({
    listingTitle: 'Sea view flat', clientName: 'Ahmed', score: 74,
    propertyId: 23, oldPrice: 480000, newPrice: 330000,
  })
  assert.match(n.body, /\$480,000 → \$330,000/)
  assert.match(n.body, /74%/)
  assert.match(n.body, /Ahmed/)
})

test('a new client NEVER names the client', () => {
  // This one goes to the agent whose LISTING matched. The client belongs to a
  // colleague, and a lock screen is the easiest place in the app to leak a name
  // that every screen is careful about.
  const n = newClientPush({ listingTitle: '210 m² Apartment in Geitawi', score: 91, propertyId: 182 })
  assert.equal(n.title, 'A new client matches your listing')
  assert.match(n.body, /210 m² Apartment in Geitawi/)
  assert.match(n.body, /91% match/)
  assert.match(n.body, /Open to see who/)
  // Nothing that could be a person.
  assert.equal(/charbel|ahmed|client name/i.test(n.body), false)
})

test('repeat alerts about one listing collapse instead of stacking', () => {
  // Same tag means the phone replaces the previous notification. Three price
  // cuts on one listing should be one line on the lock screen.
  const a = newListingPush({ listingTitle: 'X', clientName: 'A', score: 60, propertyId: 7 })
  const b = priceDropPush({ listingTitle: 'X', clientName: 'A', score: 80, propertyId: 7, oldPrice: 9, newPrice: 8 })
  assert.equal(a.tag, b.tag)
  // A new-client alert is a different kind of news, so it stands on its own.
  assert.notEqual(newClientPush({ listingTitle: 'X', score: 60, propertyId: 7 }).tag, a.tag)
})

test('every notification lands somewhere useful', () => {
  for (const n of [
    newListingPush({ listingTitle: 'X', clientName: 'A', score: 1, propertyId: 5 }),
    priceDropPush({ listingTitle: 'X', clientName: 'A', score: 1, propertyId: 5, oldPrice: 2, newPrice: 1 }),
    newClientPush({ listingTitle: 'X', score: 1, propertyId: 5 }),
  ]) {
    assert.match(n.url, /^\/properties\?open=5$/)
    assert.ok(n.title.length > 0 && n.body.length > 0)
    // Long enough to be useful, short enough that a phone does not truncate the
    // part that matters.
    assert.ok(n.body.length < 120, `too long for a lock screen: ${n.body}`)
  }
})
