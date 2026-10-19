import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterProperties, filterClients } from './search.ts'

const props = [
  { id: 1, title: 'Sea View Flat', district: 'Achrafieh', city: 'Beirut', type: 'Apartment', transaction: 'For Sale', status: 'Available', view: 'Sea' },
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

// ── Filtering by agent (a manager's view) ───────────────────────────────────
// An agent already has the Mine / All switch, which is this question asked
// about themselves. The picker is for a manager who needs to see one agent's
// book without reading every row in the list.

const byAgent = [
  { id: 1, title: 'Sea view flat', type: 'Apartment', transaction: 'For Sale', status: 'Available', district: '', city: 'Achrafieh', agentId: 'NH-1' },
  { id: 2, title: 'Hamra studio', type: 'Studio', transaction: 'For Rent', status: 'Available', district: '', city: 'Hamra', agentId: 'SM-2' },
  { id: 3, title: 'Jounieh villa', type: 'Villa', transaction: 'For Sale', status: 'Available', district: '', city: 'Jounieh', agentId: 'NH-1' },
]

test('filterProperties: one agent, or the whole agency', () => {
  assert.deepEqual(filterProperties(byAgent, { agent: 'NH-1' }).map(p => p.id), [1, 3])
  assert.deepEqual(filterProperties(byAgent, { agent: 'SM-2' }).map(p => p.id), [2])
  // Empty means no constraint — the same as not asking.
  assert.equal(filterProperties(byAgent, { agent: '' }).length, 3)
  assert.equal(filterProperties(byAgent, {}).length, 3)
  // An agent with nothing listed returns nothing, rather than everything.
  assert.deepEqual(filterProperties(byAgent, { agent: 'ZZ-9' }), [])
})

test('filterProperties: the agent filter combines with the others', () => {
  assert.deepEqual(filterProperties(byAgent, { agent: 'NH-1', transaction: 'For Sale' }).map(p => p.id), [1, 3])
  assert.deepEqual(filterProperties(byAgent, { agent: 'NH-1', type: 'Villa' }).map(p => p.id), [3])
  assert.deepEqual(filterProperties(byAgent, { agent: 'NH-1', q: 'hamra' }), [])
})

const clientsByAgent = [
  { id: 1, name: 'Ahmed', phone: '03 1', type: 'Buyer', status: 'Searching', agentId: 'NH-1', req: { location: 'Achrafieh' } },
  { id: 2, name: 'Rania', phone: '03 2', type: 'Renter', status: 'Viewing', agentId: 'SM-2', req: { location: 'Hamra' } },
  { id: 3, name: 'Georges', phone: '03 3', type: 'Buyer', status: 'Searching', agentId: 'NH-1', req: { location: 'Jounieh' } },
]

test('filterClients: one agent, or the whole agency', () => {
  assert.deepEqual(filterClients(clientsByAgent, { agent: 'NH-1' }).map(c => c.id), [1, 3])
  assert.deepEqual(filterClients(clientsByAgent, { agent: 'SM-2' }).map(c => c.id), [2])
  assert.equal(filterClients(clientsByAgent, { agent: '' }).length, 3)
  assert.deepEqual(filterClients(clientsByAgent, { agent: 'ZZ-9' }), [])
})

test('filterClients: the agent filter combines with the others', () => {
  assert.deepEqual(filterClients(clientsByAgent, { agent: 'NH-1', type: 'Buyer' }).map(c => c.id), [1, 3])
  assert.deepEqual(filterClients(clientsByAgent, { agent: 'NH-1', q: 'rania' }), [])
})

// ── Price, size and bedrooms ────────────────────────────────────────────────

const stock = [
  // Sales, priced in the hundreds of thousands.
  { id: 10, title: 'Flat A',  type: 'Apartment', transaction: 'For Sale', status: 'Available', price: 250000, rent: 0,    size: 120, beds: 2, district: '', city: '' },
  { id: 11, title: 'Flat B',  type: 'Apartment', transaction: 'For Sale', status: 'Available', price: 400000, rent: 0,    size: 200, beds: 3, district: '', city: '' },
  { id: 12, title: 'Villa C', type: 'Villa',     transaction: 'For Sale', status: 'Available', price: 900000, rent: 0,    size: 400, beds: 5, district: '', city: '' },
  // Rentals, priced per month.
  { id: 20, title: 'Flat D',  type: 'Apartment', transaction: 'For Rent', status: 'Available', price: 0,      rent: 600,  size: 110, beds: 2, district: '', city: '' },
  { id: 21, title: 'Flat E',  type: 'Apartment', transaction: 'For Rent', status: 'Available', price: 0,      rent: 1500, size: 180, beds: 3, district: '', city: '' },
  // No bedrooms, and one with nothing recorded at all.
  { id: 30, title: 'Shop F',  type: 'Shop',      transaction: 'For Sale', status: 'Available', price: 300000, rent: 0,    size: 80,  beds: 0, district: '', city: '' },
  { id: 40, title: 'Plot G',  type: 'Land',      transaction: 'For Sale', status: 'Available', price: 0,      rent: 0,    size: 0,   beds: 0, district: '', city: '' },
]
const ids = f => filterProperties(stock, f).map(p => p.id)

test('filterProperties: a rental is judged on its rent, not its empty sale price', () => {
  // The bug this guards: comparing every listing against `price` makes rentals
  // cost zero, so they slip into every budget — and a rent search returns none.
  assert.deepEqual(ids({ priceMin: 200000, priceMax: 500000 }), [10, 11, 30])
  assert.deepEqual(ids({ priceMin: 500, priceMax: 1000 }), [20])
  assert.deepEqual(ids({ priceMax: 1600, transaction: 'For Rent' }), [20, 21])
})

test('filterProperties: one-sided price bounds', () => {
  assert.deepEqual(ids({ priceMin: 500000 }), [12])
  assert.deepEqual(ids({ priceMax: 300000 }), [10, 20, 21, 30])
})

test('filterProperties: a listing with no price is not claimed to be in range', () => {
  // "Price on request" must not quietly appear in every budget search.
  assert.equal(ids({ priceMin: 1, priceMax: 10000000 }).includes(40), false)
  // With no price filter it is still listed.
  assert.ok(ids({}).includes(40))
})

test('filterProperties: size range, and unknown size excluded from it', () => {
  assert.deepEqual(ids({ sizeMin: 150 }), [11, 12, 21])
  assert.deepEqual(ids({ sizeMin: 100, sizeMax: 200 }), [10, 11, 20, 21])
  assert.equal(ids({ sizeMin: 1 }).includes(40), false)
})

test('filterProperties: bedrooms is a minimum, the way agents ask for it', () => {
  assert.deepEqual(ids({ bedsMin: 3 }), [11, 12, 21])
  assert.deepEqual(ids({ bedsMin: 5 }), [12])
  // A shop and a plot have no bedrooms, so "2+ beds" rightly excludes them.
  assert.equal(ids({ bedsMin: 2 }).includes(30), false)
  assert.equal(ids({ bedsMin: 2 }).includes(40), false)
})

test('filterProperties: the new filters combine with the old ones', () => {
  assert.deepEqual(ids({ type: 'Apartment', transaction: 'For Sale', priceMin: 300000, bedsMin: 3 }), [11])
  assert.deepEqual(ids({ q: 'flat', transaction: 'For Rent', sizeMin: 150 }), [21])
})

test('filterProperties: blank, zero and junk bounds mean "no bound"', () => {
  // The page hands these over as Number(''), which is 0 — it must not read as
  // "max price zero" and empty the list.
  const all = ids({})
  for (const f of [
    { priceMin: 0, priceMax: 0 }, { sizeMin: 0, sizeMax: 0 }, { bedsMin: 0 },
    { priceMin: NaN }, { priceMax: undefined }, { bedsMin: null },
  ]) assert.deepEqual(ids(f), all, JSON.stringify(f))
})
