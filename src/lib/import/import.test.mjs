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

// ── Messy real-world sheets ──────────────────────────────────────────────────
import { toBeds, toSize, guessPropertyType, normPropertyStatus, normClientStatus, dedupeKey } from './mapping.ts'

test('toNumber: a budget range reads as its upper end, suffix shared', () => {
  assert.equal(toNumber('500-700k'), 700_000)
  assert.equal(toNumber('500k - 700k'), 700_000)
  assert.equal(toNumber('$300,000 to $450,000'), 450_000)
  assert.equal(toNumber('1.2m'), 1_200_000)      // no range: unchanged
  assert.equal(toNumber('$450,000'), 450_000)
})

test('toBeds: "3+1" is 3 bedrooms, not 31', () => {
  assert.equal(toBeds('3+1'), 3)
  assert.equal(toBeds('4'), 4)
  assert.equal(toBeds('studio'), null)
  assert.equal(toBeds(''), null)
})

test('toSize: unit digits are not part of the number; sq ft converts', () => {
  assert.equal(toSize('2000 m2'), 2000)
  assert.equal(toSize('180 sqm'), 180)
  assert.equal(toSize('320 m²'), 320)
  assert.equal(toSize('1000 sq ft'), 93)
  assert.equal(toSize('55'), 55)
})

test('guessPropertyType: title keywords, Arabic, type column first, apartment default', () => {
  assert.equal(guessPropertyType(undefined, 'Villa Broumana'), 'Villa')
  assert.equal(guessPropertyType(undefined, 'Office Jounieh'), 'Office')
  assert.equal(guessPropertyType(undefined, 'Land Zahle'), 'Land')
  assert.equal(guessPropertyType(undefined, 'Studio Hamra'), 'Studio')
  assert.equal(guessPropertyType(undefined, 'Apartment in a building'), 'Appartement')
  assert.equal(guessPropertyType(undefined, 'شقة في الأشرفية'), 'Appartement')
  assert.equal(guessPropertyType('Duplex', 'Sea view, Raouche'), 'Duplex')
  assert.equal(guessPropertyType(undefined, 'Sea view, Raouche'), 'Appartement')
})

test('normPropertyStatus: only the app statuses come out', () => {
  assert.equal(normPropertyStatus('active'), 'Available')
  assert.equal(normPropertyStatus(''), 'Available')
  assert.equal(normPropertyStatus(' SOLD '), 'Sold')
  assert.equal(normPropertyStatus('rented out'), 'Rented')
  assert.equal(normPropertyStatus('under construction'), 'Under Construction')
  assert.equal(normClientStatus('hot'), 'Searching')
  assert.equal(normClientStatus('negotiation'), 'Negotiation')
})

test('dedupeKey: same listing / same client match regardless of case, spacing, phone format', () => {
  const a = { title: 'Sea view  apartment', price: 450000, city: 'Beirut', district: '', transaction: 'sale' }
  const b = { title: 'sea view apartment', price: 450000, city: 'beirut', district: '', transaction: 'sale' }
  assert.equal(dedupeKey('properties', a), dedupeKey('properties', b))
  assert.notEqual(dedupeKey('properties', a), dedupeKey('properties', { ...b, price: 460000 }))
  assert.equal(dedupeKey('clients', { name: 'Rana', phone: '71 998877' }), dedupeKey('clients', { name: 'rana', phone: '71-998877' }))
})

test('applyMapping: the full messy row comes out right', () => {
  const headers = ['Ref', 'Description', 'Price $', 'Beds', 'Sqm', 'Sale/Rent', 'Status', 'Owner Phone', 'Notes']
  const map = { title: 'Description', price: 'Price $', bedrooms: 'Beds', size: 'Sqm', transaction: 'Sale/Rent', status: 'Status', ownerContact: 'Owner Phone', reference: 'Ref', notes: 'Notes' }
  const [p] = applyMapping('properties', headers, [['A104', 'Villa Broumana', '800k', '3+1', '2000 m2', 'Sale', 'active', '03 555111', 'call first']], map)
  assert.equal(p.type, 'Villa')
  assert.equal(p.bedrooms, 3)
  assert.equal(p.size, 2000)
  assert.equal(p.status, 'Available')
  assert.equal(p.ownerContact, '03 555111')
  assert.equal(p.notes, 'Ref A104 · call first')
})
