// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/microsite-filter.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyFilters, filterOptions, filtersFromQuery, filtersToQuery, isFiltered, NO_FILTERS, askingPrice } from './microsite-filter.ts'

const card = (id, o) => ({ id, type: 'Apartment', transaction: 'For Sale', price: 0, rent: 0, district: '', city: '', beds: 0, ...o })
const CARDS = [
  card(1, { price: 320000, district: 'Achrafieh', city: 'Beirut', beds: 3 }),
  card(2, { transaction: 'For Rent', rent: 1200, district: 'Hamra', city: 'Beirut', beds: 2 }),
  card(3, { type: 'Villa', price: 900000, district: 'Ghazir', city: 'Keserwan', beds: 5 }),
  card(4, { transaction: 'For Rent', rent: 650, district: 'Jounieh', city: 'Keserwan', beds: 1 }),
  card(5, { type: 'Land', price: 0, district: 'Batroun', city: 'North' }),   // price on request
]
const ids = (f) => applyFilters(CARDS, { ...NO_FILTERS, ...f }).map(c => c.id)

test('no filters: everything, newest first (as given)', () => {
  assert.deepEqual(ids({}), [1, 2, 3, 4, 5])
  assert.equal(isFiltered(NO_FILTERS), false)
})

test('buy or rent', () => {
  assert.deepEqual(ids({ deal: 'rent' }), [2, 4])
  assert.deepEqual(ids({ deal: 'sale' }), [1, 3, 5])
})

test('type and area (district or city, any case)', () => {
  assert.deepEqual(ids({ type: 'villa' }), [3])
  assert.deepEqual(ids({ area: 'Keserwan' }), [3, 4])
  assert.deepEqual(ids({ area: 'hamra' }), [2])
})

test('minimum bedrooms', () => {
  assert.deepEqual(ids({ beds: 3 }), [1, 3])
})

test('price range uses the monthly rent for rentals; unpriced listings stay', () => {
  assert.equal(askingPrice(CARDS[1]), 1200)
  assert.deepEqual(ids({ deal: 'rent', maxPrice: 1000 }), [4])
  assert.deepEqual(ids({ deal: 'sale', minPrice: 300000, maxPrice: 500000 }), [1, 5])
})

test('sorting by price puts unpriced listings last', () => {
  assert.deepEqual(ids({ deal: 'sale', sort: 'price_asc' }), [1, 3, 5])
  assert.deepEqual(ids({ deal: 'sale', sort: 'price_desc' }), [3, 1, 5])
})

test('options list only what the agency has', () => {
  const o = filterOptions(CARDS)
  assert.deepEqual(o.types, ['Apartment', 'Land', 'Villa'])
  assert.ok(o.areas.includes('Keserwan') && o.areas.includes('Hamra'))
  assert.equal(o.hasRent && o.hasSale, true)
})

test('filters survive a round trip through the URL, and junk is ignored', () => {
  const f = { ...NO_FILTERS, deal: 'rent', area: 'Jounieh', maxPrice: 1000, beds: 2, sort: 'price_asc' }
  const q = filtersToQuery(f, new URLSearchParams('from=app'))
  assert.equal(q.get('from'), 'app', 'other params are kept')
  assert.deepEqual(filtersFromQuery(q), f)
  assert.deepEqual(filtersFromQuery(new URLSearchParams('deal=steal&beds=-3&min=abc&sort=random')), NO_FILTERS)
})
