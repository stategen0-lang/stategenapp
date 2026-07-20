// Unit tests for the WhatsApp write layer (src/lib/whatsapp/writes.ts).
// This is the code that decides what reaches the database, so the whitelist
// and the JSON-merge behaviour are tested hardest.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toMoney, toCount, toText, toEnum,
  buildUpdate, buildNewProperty, hasChanges,
  mergeExtras, appendLog, confirmationText,
  CLIENT_FIELDS, PROPERTY_FIELDS,
} from './writes.ts'

// ── Coercions ───────────────────────────────────────────────────────────────
test('toMoney: shorthand, symbols and separators', () => {
  assert.equal(toMoney('400k'), 400_000)
  assert.equal(toMoney('1.2m'), 1_200_000)
  assert.equal(toMoney('$450,000'), 450_000)
  assert.equal(toMoney(' 250000 '), 250_000)
  assert.equal(toMoney(500_000), 500_000)
})
test('toMoney: rejects junk and non-positive values', () => {
  assert.equal(toMoney('cheap'), null)
  assert.equal(toMoney(''), null)
  assert.equal(toMoney(0), null)
  assert.equal(toMoney(-5), null)
  assert.equal(toMoney(null), null)
  assert.equal(toMoney('400k or so'), null)   // ambiguous: don't guess
})
test('toCount: plain counts only', () => {
  assert.equal(toCount('3'), 3)
  assert.equal(toCount(0), 0)
  assert.equal(toCount('abc'), null)
  assert.equal(toCount(-1), null)
  assert.equal(toCount(5000), null)
})
test('toText: trims, drops blanks, caps length', () => {
  assert.equal(toText('  Hamra  '), 'Hamra')
  assert.equal(toText('   '), null)
  assert.equal(toText('x'.repeat(900)).length, 500)
})
test('toEnum: case-insensitive, returns the canonical spelling', () => {
  const f = toEnum(['Available', 'Sold'])
  assert.equal(f('sold'), 'Sold')
  assert.equal(f('AVAILABLE'), 'Available')
  assert.equal(f('pending'), null)
})

// ── The whitelist ───────────────────────────────────────────────────────────
test('buildUpdate: maps known client fields onto real columns', () => {
  const u = buildUpdate({ budget: '400k', status: 'closed' }, CLIENT_FIELDS)
  assert.equal(u.columns['budget_max'], 400_000)
  assert.equal(u.columns['status'], 'Closed')
  assert.deepEqual(u.rejected, [])
})
test('buildUpdate: budget writes both columns so min/max cannot disagree', () => {
  const u = buildUpdate({ budget: 300_000 }, CLIENT_FIELDS)
  assert.equal(u.columns['budget_max'], 300_000)
  assert.equal(u.columns['budget_min'], 300_000)
})
test('buildUpdate: unknown fields are rejected, never written', () => {
  const u = buildUpdate({ budget: '400k', company_id: 99, role: 'owner', id: 1 }, CLIENT_FIELDS)
  assert.deepEqual(Object.keys(u.columns).sort(), ['budget_max', 'budget_min'])
  assert.deepEqual(u.rejected.sort(), ['company_id', 'id', 'role'])
})
test('buildUpdate: a value that fails coercion is rejected, not coerced to junk', () => {
  const u = buildUpdate({ budget: 'lots', status: 'exploded' }, CLIENT_FIELDS)
  assert.equal(hasChanges(u), false)
  assert.deepEqual(u.rejected.sort(), ['budget', 'status'])
})
test('buildUpdate: extras fields are kept separate from real columns', () => {
  const u = buildUpdate({ rent: '1200', status: 'rented' }, PROPERTY_FIELDS)
  assert.equal(u.extras.rent, 1200)
  assert.equal(u.columns['Status'], 'Rented')
  assert.equal('rent' in u.columns, false)
})
test('buildUpdate: aliases resolve to the same column', () => {
  assert.equal(buildUpdate({ beds: 3 }, PROPERTY_FIELDS).columns['Bedrooms'], 3)
  assert.equal(buildUpdate({ bedrooms: 3 }, PROPERTY_FIELDS).columns['Bedrooms'], 3)
  assert.equal(buildUpdate({ district: 'Hamra' }, PROPERTY_FIELDS).columns['Neighborhood'], 'Hamra')
})
test('buildUpdate: key matching is case-insensitive and trimmed', () => {
  const u = buildUpdate({ ' Budget ': '400k' }, CLIENT_FIELDS)
  assert.equal(u.columns['budget_max'], 400_000)
})
test('buildUpdate: no fields at all is empty, not an error', () => {
  const u = buildUpdate(undefined, CLIENT_FIELDS)
  assert.equal(hasChanges(u), false)
  assert.deepEqual(u.rejected, [])
})
test('buildUpdate: money changes are formatted for the confirmation', () => {
  const u = buildUpdate({ budget: '400k' }, CLIENT_FIELDS)
  assert.deepEqual(u.changes, ['Budget: $400,000'])
})

// ── JSON blob handling (the bug that damaged a real listing) ────────────────
test('mergeExtras: keeps keys that were not mentioned', () => {
  const before = JSON.stringify({ agentId: 'a2', transaction: 'For Rent', aiDescription: 'nice' })
  const after = JSON.parse(mergeExtras(before, { rent: 1200 }))
  assert.equal(after.agentId, 'a2')
  assert.equal(after.transaction, 'For Rent')
  assert.equal(after.aiDescription, 'nice')
  assert.equal(after.rent, 1200)
})
test('mergeExtras: new value overrides the old one', () => {
  const after = JSON.parse(mergeExtras(JSON.stringify({ rent: 900 }), { rent: 1200 }))
  assert.equal(after.rent, 1200)
})
test('mergeExtras: corrupt or empty blobs do not throw', () => {
  assert.deepEqual(JSON.parse(mergeExtras('{not json', { rent: 1 })), { rent: 1 })
  assert.deepEqual(JSON.parse(mergeExtras(null, { rent: 1 })), { rent: 1 })
  assert.deepEqual(JSON.parse(mergeExtras('[1,2]', { rent: 1 })), { rent: 1 })
})
test('appendLog: newest first, existing keys preserved', () => {
  const before = JSON.stringify({ agentId: 'a1', log: [{ at: '2026-01-01T00:00:00Z', note: 'old' }] })
  const after = JSON.parse(appendLog(before, 'called, wants Saturday'))
  assert.equal(after.agentId, 'a1')
  assert.equal(after.log.length, 2)
  assert.equal(after.log[0].note, 'called, wants Saturday')
  assert.equal(after.log[1].note, 'old')
})
test('appendLog: caps the history so a row cannot grow without bound', () => {
  let blob = '{}'
  for (let i = 0; i < 60; i++) blob = appendLog(blob, `note ${i}`)
  const parsed = JSON.parse(blob)
  assert.equal(parsed.log.length, 50)
  assert.equal(parsed.log[0].note, 'note 59')
})
test('appendLog: replaces a non-array log rather than crashing', () => {
  const after = JSON.parse(appendLog(JSON.stringify({ log: 'oops' }), 'first'))
  assert.equal(after.log.length, 1)
})

// ── Confirmation text ───────────────────────────────────────────────────────
test('confirmationText: states the record, the changes and how to reply', () => {
  const t = confirmationText('Ahmed Khoury', ['Budget: $400,000'])
  assert.match(t, /Ahmed Khoury/)
  assert.match(t, /Budget: \$400,000/)
  assert.match(t, /YES/)
  assert.match(t, /NO/)
})
test('confirmationText: discloses what it is ignoring', () => {
  const t = confirmationText('Ahmed', ['Budget: $400,000'], ['commission'])
  assert.match(t, /Ignoring: commission/)
})

// ── New listings ────────────────────────────────────────────────────────────
test('buildNewProperty: reports which required fields are missing', () => {
  const b = buildNewProperty({ beds: 3 })
  assert.deepEqual(b.missing.sort(), ['City', 'Price', 'Title'])
})
test('buildNewProperty: complete input has nothing missing', () => {
  const b = buildNewProperty({ title: 'Hamra flat', price: '450k', location: 'Beirut', beds: 3, size: 180 })
  assert.deepEqual(b.missing, [])
  assert.equal(b.columns['Title'], 'Hamra flat')
  assert.equal(b.columns['Price'], 450_000)
  assert.equal(b.columns['Location'], 'Beirut')
  assert.equal(b.columns['Bedrooms'], 3)
})
test('buildNewProperty: a price that will not parse counts as missing', () => {
  const b = buildNewProperty({ title: 'Flat', price: 'negotiable', location: 'Beirut' })
  assert.deepEqual(b.missing, ['Price'])
})
