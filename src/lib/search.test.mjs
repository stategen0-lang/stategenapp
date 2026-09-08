import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterProperties, filterClients } from './search.ts'

const props = [
  { id: 1, title: 'Sea View Flat', district: 'Achrafieh', city: 'Beirut', type: 'Appartement', transaction: 'For Sale', status: 'Available', view: 'Sea' },
  { id: 2, title: 'Hillside Villa', district: 'Broumana', city: 'Metn', type: 'Villa', transaction: 'For Sale', status: 'Sold', view: 'Mountain' },
  { id: 3, title: 'Downtown Office', district: 'Hamra', city: 'Beirut', type: 'Office', transaction: 'For Rent', status: 'Available', view: '' },
]

test('filterProperties: text matches title/area/type', () => {
  assert.deepEqual(filterProperties(props, { q: 'achrafieh' }).map(p => p.id), [1])
  assert.deepEqual(filterProperties(props, { q: 'villa' }).map(p => p.id), [2])
  assert.deepEqual(filterProperties(props, { q: 'beirut' }).map(p => p.id), [1, 3])
})

test('filterProperties: multi-word is AND, any order', () => {
  assert.deepEqual(filterProperties(props, { q: 'beirut office' }).map(p => p.id), [3])
  assert.deepEqual(filterProperties(props, { q: 'office beirut' }).map(p => p.id), [3])
})

test('filterProperties: dropdown filters combine with text', () => {
  assert.deepEqual(filterProperties(props, { transaction: 'For Rent' }).map(p => p.id), [3])
  assert.deepEqual(filterProperties(props, { status: 'Available' }).map(p => p.id), [1, 3])
  assert.deepEqual(filterProperties(props, { type: 'Villa' }).map(p => p.id), [2])
  assert.deepEqual(filterProperties(props, { q: 'beirut', status: 'Available', transaction: 'For Sale' }).map(p => p.id), [1])
})

test('filterProperties: empty filters return everything, #id search works', () => {
  assert.equal(filterProperties(props, {}).length, 3)
  assert.deepEqual(filterProperties(props, { q: '#2' }).map(p => p.id), [2])
})

const clients = [
  { id: 1, name: 'Michel Tanios', phone: '+961 3 221 904', type: 'Buyer', status: 'Searching', req: { location: 'Metn' } },
  { id: 2, name: 'Sara Stephan', phone: '+961 71 309 887', type: 'Renter', status: 'Signed', req: { location: 'Beirut' } },
]

test('filterClients: text matches name/phone/location', () => {
  assert.deepEqual(filterClients(clients, { q: 'michel' }).map(c => c.id), [1])
  assert.deepEqual(filterClients(clients, { q: '309' }).map(c => c.id), [2])
  assert.deepEqual(filterClients(clients, { q: 'metn' }).map(c => c.id), [1])
})

test('filterClients: type + status filters', () => {
  assert.deepEqual(filterClients(clients, { type: 'Renter' }).map(c => c.id), [2])
  assert.deepEqual(filterClients(clients, { status: 'Searching' }).map(c => c.id), [1])
})
