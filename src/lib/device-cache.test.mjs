// Unit tests for the on-device data cache (device-cache.ts). Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readCache, writeCache, clearDeviceCache, setCacheOwner, MAX_AGE_MS } from './device-cache.ts'

/** A stand-in for localStorage. */
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: k => { map.delete(k) },
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
}

test('writes and reads back', () => {
  const s = fakeStore()
  writeCache('properties', [{ id: 1 }], 1000, s)
  assert.deepEqual(readCache('properties', 1000, s), [{ id: 1 }])
})

test('a missing or unreadable entry reads as null', () => {
  const s = fakeStore({ 'sg.cache.broken': '{not json' })
  assert.equal(readCache('nothing', 1000, s), null)
  assert.equal(readCache('broken', 1000, s), null)
})

test('stale data is ignored and dropped', () => {
  const s = fakeStore()
  writeCache('clients', [1, 2], 0, s)
  assert.deepEqual(readCache('clients', MAX_AGE_MS - 1, s), [1, 2])
  assert.equal(readCache('clients', MAX_AGE_MS + 1, s), null)
  assert.equal(s.getItem('sg.cache.clients'), null)   // removed, not left to rot
})

test('changing user wipes the previous user\'s data', () => {
  const s = fakeStore()
  setCacheOwner('user-a', s)
  writeCache('clients', ['a client'], 1000, s)
  setCacheOwner('user-a', s)                          // same user: kept
  assert.deepEqual(readCache('clients', 1000, s), ['a client'])
  setCacheOwner('user-b', s)                          // different user: gone
  assert.equal(readCache('clients', 1000, s), null)
  writeCache('clients', ['b client'], 1000, s)
  setCacheOwner(null, s)                              // signed out: gone
  assert.equal(readCache('clients', 1000, s), null)
})

test('clearDeviceCache leaves other apps\' keys alone', () => {
  const s = fakeStore({ 'sb-auth-token': 'keep me' })
  writeCache('properties', [1], 1000, s)
  clearDeviceCache(s)
  assert.equal(readCache('properties', 1000, s), null)
  assert.equal(s.getItem('sb-auth-token'), 'keep me')
})

test('an oversized payload is skipped, not stored', () => {
  const s = fakeStore()
  writeCache('huge', 'x'.repeat(1_600_000), 1000, s)
  assert.equal(readCache('huge', 1000, s), null)
})

test('no storage (private mode) is not an error', () => {
  assert.equal(readCache('x', 1000, null), null)
  assert.doesNotThrow(() => writeCache('x', [1], 1000, null))
  assert.doesNotThrow(() => clearDeviceCache(null))
  assert.doesNotThrow(() => setCacheOwner('u', null))
})
