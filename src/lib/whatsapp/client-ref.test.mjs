// Unit tests for client-reference parsing (src/lib/whatsapp/client-ref.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitClientRef } from './client-ref.ts'

test('splitClientRef: a plain name has no location', () => {
  assert.deepEqual(splitClientRef('Ahmed'), { name: 'Ahmed' })
  assert.deepEqual(splitClientRef('Nour Sleiman'), { name: 'Nour Sleiman' })
})
test('splitClientRef: "name in area" splits out the area', () => {
  assert.deepEqual(splitClientRef('Nour Sleiman in Beit Mery'), { name: 'Nour Sleiman', location: 'Beit Mery' })
  assert.deepEqual(splitClientRef('Ahmed in Hamra'), { name: 'Ahmed', location: 'Hamra' })
})
test('splitClientRef: splits on the LAST "in" so multi-word areas survive', () => {
  assert.deepEqual(splitClientRef('Martin in Sin el Fil'), { name: 'Martin', location: 'Sin el Fil' })
})
test('splitClientRef: an "in" that is part of a word does not split', () => {
  // No area word follows, so "Robin" stays whole.
  assert.deepEqual(splitClientRef('Robin'), { name: 'Robin' })
  assert.deepEqual(splitClientRef('Yasmine'), { name: 'Yasmine' })
})
test('splitClientRef: trims and tolerates empty', () => {
  assert.deepEqual(splitClientRef('  Ahmed  '), { name: 'Ahmed' })
  assert.deepEqual(splitClientRef(''), { name: '' })
  assert.deepEqual(splitClientRef(null), { name: '' })
  assert.deepEqual(splitClientRef(undefined), { name: '' })
})
test('splitClientRef: does not split on a number-only area', () => {
  // "in 3" is not an area — leave it on the name for the caller to handle.
  assert.equal(splitClientRef('Ahmed in 3').location, undefined)
})
