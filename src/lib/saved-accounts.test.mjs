// Tests for the saved-accounts list behind "Switch account" (src/lib/saved-accounts.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSaved, upsertAccount, removeAccount, isSameAccount, initialsOf,
  loadSaved, rememberAccount, SAVED_ACCOUNTS_KEY, MAX_SAVED_ACCOUNTS,
} from './saved-accounts.ts'

const fakeStore = (initial = {}) => {
  const m = new Map(Object.entries(initial))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v) }, _m: m }
}

test('parseSaved: junk, wrong shapes and bad JSON become an empty list', () => {
  assert.deepEqual(parseSaved(null), [])
  assert.deepEqual(parseSaved(''), [])
  assert.deepEqual(parseSaved('not json'), [])
  assert.deepEqual(parseSaved('{"a":1}'), [])
  assert.deepEqual(parseSaved('[1, null, "x", {"name":"no id"}, {"id":"  "}]'), [])
})

test('parseSaved: keeps valid entries, fills a missing name with the id, drops duplicates', () => {
  const out = parseSaved(JSON.stringify([
    { id: 'LK-221', name: 'Lara Khoury', at: 5 },
    { id: 'lk-221', name: 'dup', at: 9 },          // same account, different case
    { id: 'rami@agency.com', at: 7 },              // no name
  ]))
  assert.deepEqual(out.map(a => a.id), ['rami@agency.com', 'LK-221'])   // most recent first
  assert.equal(out.find(a => a.id === 'rami@agency.com').name, 'rami@agency.com')
  assert.equal(out.length, 2)
})

test('upsertAccount: newest first, same account (any case) is refreshed not duplicated', () => {
  let l = []
  l = upsertAccount(l, { id: 'LK-221', name: 'Lara Khoury' }, 100)
  l = upsertAccount(l, { id: 'rami@agency.com', name: 'Rami Saad' }, 200)
  assert.deepEqual(l.map(a => a.id), ['rami@agency.com', 'LK-221'])
  l = upsertAccount(l, { id: 'lk-221' }, 300)              // signs in again, name unknown
  assert.deepEqual(l.map(a => a.id), ['lk-221', 'rami@agency.com'])
  assert.equal(l[0].name, 'Lara Khoury')                   // keeps the name it already had
  assert.equal(l.length, 2)
})

test('upsertAccount: capped, dropping the least recently used', () => {
  let l = []
  for (let i = 0; i < MAX_SAVED_ACCOUNTS + 3; i++) l = upsertAccount(l, { id: `u${i}`, name: `User ${i}` }, i)
  assert.equal(l.length, MAX_SAVED_ACCOUNTS)
  assert.equal(l[0].id, `u${MAX_SAVED_ACCOUNTS + 2}`)
  assert.ok(!l.some(a => a.id === 'u0'))
})

test('upsertAccount: an empty id changes nothing', () => {
  const l = [{ id: 'a', name: 'A', at: 1 }]
  assert.equal(upsertAccount(l, { id: '   ' }), l)
})

test('removeAccount: removes by id ignoring case, leaves the rest', () => {
  const l = [{ id: 'a', name: 'A', at: 2 }, { id: 'B@x.com', name: 'B', at: 1 }]
  assert.deepEqual(removeAccount(l, 'b@X.com').map(a => a.id), ['a'])
  assert.equal(removeAccount(l, 'zzz').length, 2)
})

test('isSameAccount: case-insensitive, and false for empty values', () => {
  assert.equal(isSameAccount('LK-221', 'lk-221'), true)
  assert.equal(isSameAccount('LK-221', 'RS-100'), false)
  assert.equal(isSameAccount(null, 'x'), false)
  assert.equal(isSameAccount('', ''), false)
})

test('initialsOf: first and last initial, or two letters of one word', () => {
  assert.equal(initialsOf('Lara Khoury'), 'LK')
  assert.equal(initialsOf('  sami   abi   nader '), 'SN')
  assert.equal(initialsOf('Rami'), 'RA')
  assert.equal(initialsOf(''), '?')
})

test('rememberAccount / loadSaved: round-trips through storage and never stores secrets', () => {
  const s = fakeStore()
  rememberAccount({ id: 'LK-221', name: 'Lara Khoury' }, s)
  rememberAccount({ id: 'rami@agency.com', name: 'Rami Saad' }, s)
  const back = loadSaved(s)
  assert.deepEqual(back.map(a => a.id), ['rami@agency.com', 'LK-221'])
  const raw = s._m.get(SAVED_ACCOUNTS_KEY)
  assert.ok(!/password|token|session/i.test(raw))
})

test('loadSaved: a broken or missing store never throws', () => {
  assert.deepEqual(loadSaved(null), [])
  assert.deepEqual(loadSaved({ getItem() { throw new Error('blocked') }, setItem() {} }), [])
  assert.doesNotThrow(() => rememberAccount({ id: 'a' }, { getItem() { return null }, setItem() { throw new Error('full') } }))
})
