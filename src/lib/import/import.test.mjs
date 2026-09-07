import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from './parse.ts'
import { applyMapping, isValidRow, toNumber, normTransaction, normClientType } from './mapping.ts'

// ── parseCsv ─────────────────────────────────────────────────────────────────
test('parseCsv: headers + rows, trims headers, strips BOM', () => {
  const { headers, rows } = parseCsv('﻿ Name , Price\nVilla,250000\nApt,90000\n')
  assert.deepEqual(headers, ['Name', 'Price'])
  assert.deepEqual(rows, [['Villa', '250000'], ['Apt', '90000']])
})

test('parseCsv: quoted fields with commas and escaped quotes', () => {
  const { rows } = parseCsv('a,b\n"Beirut, Achrafieh","He said ""hi"""\n')
  assert.deepEqual(rows[0], ['Beirut, Achrafieh', 'He said "hi"'])
})

test('parseCsv: embedded newline inside quotes stays one field', () => {
  const { rows } = parseCsv('a,b\n"line1\nline2",x\n')
  assert.deepEqual(rows[0], ['line1\nline2', 'x'])
})

test('parseCsv: handles CRLF and a missing trailing newline', () => {
  const { headers, rows } = parseCsv('a,b\r\n1,2\r\n3,4')
  assert.deepEqual(headers, ['a', 'b'])
  assert.deepEqual(rows, [['1', '2'], ['3', '4']])
})

test('parseCsv: drops fully-blank rows', () => {
  const { rows } = parseCsv('a,b\n1,2\n,\n\n3,4\n')
  assert.deepEqual(rows, [['1', '2'], ['3', '4']])
})

// ── coercion ─────────────────────────────────────────────────────────────────
test('toNumber: strips currency/commas', () => {
  assert.equal(toNumber('$250,000'), 250000)
  assert.equal(toNumber('90000 USD'), 90000)
  assert.equal(toNumber(''), null)
  assert.equal(toNumber('n/a'), null)
})

test('toNumber: k/m shorthand, but not "320 sqm"', () => {
  assert.equal(toNumber('800k'), 800000)
  assert.equal(toNumber('1.2m'), 1200000)
  assert.equal(toNumber('320 sqm'), 320)   // trailing m after non-digit → not millions
  assert.equal(toNumber('600/month'), 600)
})

test('normTransaction / normClientType: keyword detection', () => {
  assert.equal(normTransaction('For Sale'), 'sale')
  assert.equal(normTransaction('Rent'), 'rent')
  assert.equal(normTransaction('whatever'), null)
  assert.equal(normClientType('tenant looking to rent'), 'renter')
  assert.equal(normClientType('buyer'), 'buyer')
})

// ── applyMapping ─────────────────────────────────────────────────────────────
const headers = ['Property', 'Asking Price', 'Area', 'Beds', 'Type']
const rows = [
  ['Sea-view villa', '$450,000', 'Jounieh', '4', 'For Sale'],
  ['Studio', '600/mo', 'Hamra', '0', 'Rent'],
]
const mapping = { title: 'Property', price: 'Asking Price', city: 'Area', bedrooms: 'Beds', transaction: 'Type', district: null, bathrooms: null, size: null, status: null }

test('applyMapping: maps + coerces property rows by header name', () => {
  const out = applyMapping('properties', headers, rows, mapping)
  assert.equal(out[0].title, 'Sea-view villa')
  assert.equal(out[0].price, 450000)
  assert.equal(out[0].city, 'Jounieh')
  assert.equal(out[0].bedrooms, 4)
  assert.equal(out[0].transaction, 'sale')
  assert.equal(out[1].transaction, 'rent')
  assert.equal(out[1].price, 600)
})

test('applyMapping: unmapped fields come back empty/null, never throw', () => {
  const out = applyMapping('properties', headers, rows, mapping)
  assert.equal(out[0].district, '')
  assert.equal(out[0].size, null)
})

test('isValidRow: a property needs a title or price; a client needs a name', () => {
  assert.equal(isValidRow('properties', { title: 'X', price: null }), true)
  assert.equal(isValidRow('properties', { title: '', price: null }), false)
  assert.equal(isValidRow('clients', { name: 'Joe' }), true)
  assert.equal(isValidRow('clients', { name: '' }), false)
})
