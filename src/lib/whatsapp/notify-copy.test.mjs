// Unit tests for the new-client agent nudge copy. Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newClientLine, newClientCore } from './notify-copy.ts'

test('newClientCore: data only, no sentence framing (for the template {{1}})', () => {
  const s = newClientCore({ name: 'Michel Tanios', phone: '+961 3 221 904', type: 'Buyer', budget: 700000, location: 'Metn' })
  assert.match(s, /^Michel Tanios/)
  assert.match(s, /\+961 3 221 904/)
  assert.match(s, /\$700K/)
  assert.equal(/New client for you|reach out/i.test(s), false)   // framing lives in the template
  assert.equal(s.includes('\n'), false)
})

test('newClientCore: includes the referrer on a transfer', () => {
  const s = newClientCore({ name: 'Michel Tanios', type: 'Buyer', budget: 700000, location: 'Metn', referredByName: 'Rami Saad' })
  assert.match(s, /referred by Rami Saad/)
})

test('newClientLine: buyer with budget + location', () => {
  const s = newClientLine({ name: 'Michel Tanios', phone: '+961 3 221 904', type: 'Buyer', budget: 700000, location: 'Metn' })
  assert.match(s, /Michel Tanios/)
  assert.match(s, /\+961 3 221 904/)
  assert.match(s, /Buyer/)
  assert.match(s, /\$700K/)
  assert.match(s, /in Metn/)
  assert.match(s, /reach out/i)
})

test('newClientLine: renter shows monthly rent', () => {
  const s = newClientLine({ name: 'Sara Stephan', type: 'Renter', budget: 1300, location: 'Hamra' })
  assert.match(s, /\$1,300\/mo/)
})

test('newClientLine: millions render as $M', () => {
  assert.match(newClientLine({ name: 'X', type: 'Buyer', budget: 1_100_000 }), /\$1\.1M/)
  assert.match(newClientLine({ name: 'X', type: 'Buyer', budget: 2_000_000 }), /\$2M/)
})

test('newClientLine: no newlines (template-safe)', () => {
  const s = newClientLine({ name: 'A\nB', phone: '1', type: 'Buyer', budget: 500000, location: 'Beirut' })
  assert.equal(s.includes('\n'), false)
})

test('newClientLine: sparse input still reads cleanly', () => {
  const s = newClientLine({ name: 'Karim' })
  assert.match(s, /New client for you: Karim\. Please reach out/)
})

test('newClientLine: empty name falls back', () => {
  assert.match(newClientLine({ name: '' }), /A new client/)
})
