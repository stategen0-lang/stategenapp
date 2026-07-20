// Unit tests for own-first list ordering (src/lib/client-order.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortOwnFirst } from './client-order.ts'

const c = (id, agentId) => ({ id, agentId })

test('sortOwnFirst: own clients come first, others follow', () => {
  const list = [c(1, 'a1'), c(2, 'a2'), c(3, 'a1'), c(4, 'a2')]
  assert.deepEqual(sortOwnFirst(list, 'a2').map(x => x.id), [2, 4, 1, 3])
})

test('sortOwnFirst: preserves the original order within each group', () => {
  const list = [c(10, 'a1'), c(11, 'a2'), c(12, 'a1'), c(13, 'a3'), c(14, 'a2')]
  // own (a2) keep 11 before 14; the rest keep 10, 12, 13
  assert.deepEqual(sortOwnFirst(list, 'a2').map(x => x.id), [11, 14, 10, 12, 13])
})

test('sortOwnFirst: no agent code (manager) leaves the order untouched', () => {
  const list = [c(1, 'a1'), c(2, 'a2'), c(3, 'a3')]
  assert.deepEqual(sortOwnFirst(list, null).map(x => x.id), [1, 2, 3])
  assert.deepEqual(sortOwnFirst(list, undefined).map(x => x.id), [1, 2, 3])
})

test('sortOwnFirst: agent with nothing of their own gets the list unchanged', () => {
  const list = [c(1, 'a1'), c(2, 'a3')]
  assert.deepEqual(sortOwnFirst(list, 'a4').map(x => x.id), [1, 2])
})

test('sortOwnFirst: every item is the agent\'s own', () => {
  const list = [c(1, 'a2'), c(2, 'a2')]
  assert.deepEqual(sortOwnFirst(list, 'a2').map(x => x.id), [1, 2])
})

test('sortOwnFirst: tolerates missing/null agentId', () => {
  const list = [c(1, null), c(2, 'a2'), c(3, undefined)]
  assert.deepEqual(sortOwnFirst(list, 'a2').map(x => x.id), [2, 1, 3])
})

test('sortOwnFirst: does not mutate the input', () => {
  const list = [c(1, 'a1'), c(2, 'a2')]
  sortOwnFirst(list, 'a2')
  assert.deepEqual(list.map(x => x.id), [1, 2])
})

test('sortOwnFirst: empty list', () => {
  assert.deepEqual(sortOwnFirst([], 'a2'), [])
})
