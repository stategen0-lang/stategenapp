// Unit tests for duplicate detection (src/lib/dedupe.ts). Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, findClientDupes, findPropertyDupes } from './dedupe.ts'

// ── normalizePhone ─────────────────────────────────────────────────────────
test('normalizePhone: same number in different formats collapses equal', () => {
  const forms = ['+961 3 221 904', '03 221 904', '961 3 221904', '00961 3 221 904']
  const norm = forms.map(normalizePhone)
  for (const n of norm) assert.equal(n, norm[0], `${n} !== ${norm[0]}`)
})
test('normalizePhone: different numbers differ', () => {
  assert.notEqual(normalizePhone('+961 3 221 904'), normalizePhone('+961 3 999 111'))
})
test('normalizePhone: empty/nullish is safe', () => {
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone(null), '')
  assert.equal(normalizePhone(undefined), '')
})

// ── findClientDupes ────────────────────────────────────────────────────────
const clients = [
  { id: 1, name: 'Michel Tanios', phone: '+961 3 221 904' },
  { id: 2, name: 'Sara Stephan', phone: '+961 71 309 887' },
]
test('findClientDupes: matches on phone regardless of format', () => {
  const hits = findClientDupes({ name: 'Different Name', phone: '03 221 904' }, clients)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 1)
})
test('findClientDupes: matches on exact name (case/space-insensitive)', () => {
  const hits = findClientDupes({ name: '  michel   tanios ', phone: '05 000 000' }, clients)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 1)
})
test('findClientDupes: no false positive on a fresh lead', () => {
  assert.equal(findClientDupes({ name: 'New Person', phone: '+961 3 111 222' }, clients).length, 0)
})
test('findClientDupes: excludes self when editing', () => {
  const hits = findClientDupes({ name: 'Michel Tanios', phone: '+961 3 221 904' }, clients, 1)
  assert.equal(hits.length, 0)
})
test('findClientDupes: too-short phone does not match by phone', () => {
  // A 3-digit "phone" should not collapse everyone together.
  const hits = findClientDupes({ name: 'x', phone: '904' }, clients)
  assert.equal(hits.length, 0)
})

// ── findPropertyDupes ──────────────────────────────────────────────────────
const props = [
  { id: 10, title: 'Sea-view apartment', district: 'Achrafieh', city: 'Beirut', type: 'Appartement', transaction: 'For Sale', price: 500000, rent: 0 },
  { id: 11, title: 'Cozy studio', district: 'Hamra', city: 'Beirut', type: 'Appartement', transaction: 'For Rent', price: 0, rent: 1200 },
]
test('findPropertyDupes: matches on identical title', () => {
  const hits = findPropertyDupes(
    { title: 'sea-view apartment', district: 'X', city: 'Y', type: 'Villa', transaction: 'For Sale', price: 9, rent: 0 },
    props,
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 10)
})
test('findPropertyDupes: matches on same location+type+price', () => {
  const hits = findPropertyDupes(
    { title: 'totally other title', district: 'Achrafieh', city: 'Beirut', type: 'Appartement', transaction: 'For Sale', price: 500000, rent: 0 },
    props,
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 10)
})
test('findPropertyDupes: same location+type but different price is NOT a dupe', () => {
  const hits = findPropertyDupes(
    { title: 'other', district: 'Achrafieh', city: 'Beirut', type: 'Appartement', transaction: 'For Sale', price: 650000, rent: 0 },
    props,
  )
  assert.equal(hits.length, 0)
})
test('findPropertyDupes: rent compared for rentals', () => {
  const hits = findPropertyDupes(
    { title: 'x', district: 'Hamra', city: 'Beirut', type: 'Appartement', transaction: 'For Rent', price: 0, rent: 1200 },
    props,
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 11)
})
test('findPropertyDupes: excludes self when editing', () => {
  const hits = findPropertyDupes(
    { title: 'Sea-view apartment', district: 'Achrafieh', city: 'Beirut', type: 'Appartement', transaction: 'For Sale', price: 500000, rent: 0 },
    props, 10,
  )
  assert.equal(hits.length, 0)
})
