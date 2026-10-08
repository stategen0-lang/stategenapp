// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/match-query.test.mjs
//
// Matching over WhatsApp. The case that prompted all of this, from a real
// agency chat: an agent forwarded
//
//   Maya bejjany
//   81/370740
//   Looking for an apartment for rent
//   Location mazraat yachoub, ain aar, beit el chaar, dik el mehdy, aatchaneh
//   2 bedrooms
//   Unfurnished
//   600$ per month
//
// and got back "5 matches for USD 370,740" — apartments FOR SALE at $375,000
// in areas nobody asked about, every one labelled "100% match". Three separate
// faults: the phone number became the budget, the brief was thrown away before
// it reached the matcher, and with nothing left to score everything was perfect.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  budgetFromPhone, canonicalPropertyType, transactionOf, briefLocations,
  briefFromIntent, searchBrief, describeBrief, matchLines, listingLines, containsPhoneNumber,
} from './match-query.ts'
import { loadAreas } from '../lebanon/areas.ts'

const FORWARDED = `Maya bejjany
81/370740
Looking for an apartment for rent
Location mazraat yachoub, ain aar, beit el chaar, dik el mehdy, aatchaneh
2 bedrooms
Unfurnished
Well maintained building
600$ per month`

// ── A phone number is not a budget ──────────────────────────────────────────

test('digits lifted out of a phone number are rejected', () => {
  assert.equal(budgetFromPhone(FORWARDED, 370740), true)
})

test('phone numbers in every shape a Lebanese agent writes', () => {
  assert.equal(budgetFromPhone('call her on 03 123 456', 123456), true)
  assert.equal(budgetFromPhone('+961 71 998877', 998877), true)
  assert.equal(budgetFromPhone('70-123456 is the number', 123456), true)
  assert.equal(budgetFromPhone('81/370740', 81370740), false)   // the whole run IS the number given
})

test('a real budget survives', () => {
  // The whole run is the figure — nothing longer contains it.
  assert.equal(budgetFromPhone('600$ per month', 600), false)
  assert.equal(budgetFromPhone('budget 370740', 370740), false)
  assert.equal(budgetFromPhone('up to 1200000 in Achrafieh', 1200000), false)
  // Short runs are prices, floors and sizes, never phone numbers.
  assert.equal(budgetFromPhone('2 bedrooms, 150 m2, 600 a month', 600), false)
  assert.equal(budgetFromPhone('', 500000), false)
  assert.equal(budgetFromPhone('anything', 0), false)
})

// ── Reading the brief ───────────────────────────────────────────────────────

test('property types, including the French spelling agents type', () => {
  for (const [raw, want] of [
    ['apartment', 'Apartment'], ['Appartement', 'Apartment'], ['flat', 'Apartment'],
    ['VILLA', 'Villa'], ['house', 'Villa'], ['land', 'Land'], ['', ''], ['spaceship', ''],
  ]) assert.equal(canonicalPropertyType(raw), want, String(raw))
})

test('rent or sale, from however it was said', () => {
  assert.equal(transactionOf('For Rent'), 'For Rent')
  assert.equal(transactionOf('renter'), 'For Rent')
  assert.equal(transactionOf('600 per month'), 'For Rent')
  assert.equal(transactionOf('For Sale'), 'For Sale')
  assert.equal(transactionOf('buyer'), 'For Sale')
  // Unknown stays unknown — searchBrief then looks at both sides rather than
  // guessing one and hiding half the stock.
  assert.equal(transactionOf(''), '')
  assert.equal(transactionOf(undefined, null), '')
})

test('every area named is kept, however it arrived', () => {
  assert.deepEqual(
    briefLocations({ intent: 'query_property', locations: ['Mazraat Yachouh', 'Ain Aar'], location: 'Beit el Chaar' }),
    ['Mazraat Yachouh', 'Ain Aar', 'Beit el Chaar'],
  )
  // One field can still hold several, and a repeat is not a second area.
  assert.deepEqual(
    briefLocations({ intent: 'query_property', location: 'Jounieh, Kaslik, jounieh' }),
    ['Jounieh', 'Kaslik'],
  )
  assert.deepEqual(briefLocations({ intent: 'query_property' }), [])
})

test('the forwarded enquiry becomes a brief the matcher understands', () => {
  const brief = briefFromIntent({
    intent: 'query_property',
    budget: 600,
    locations: ['Mazraat Yachouh', 'Ain Aar', 'Beit el Chaar'],
    fields: { transaction: 'For Rent', type: 'apartment', beds: 2, furnishing: 'Unfurnished' },
  })
  assert.equal(brief.budget, 600)
  assert.equal(brief.req.transaction, 'For Rent')
  assert.equal(brief.req.type, 'Apartment')
  assert.equal(brief.req.beds, 2)
  assert.equal(brief.req.furnishing, 'Unfurnished')
  assert.deepEqual(brief.req.locations, ['Mazraat Yachouh', 'Ain Aar', 'Beit el Chaar'])
  // 'Renter' so that, if transaction were ever blank, the matcher derives rent.
  assert.equal(brief.type, 'Renter')
})

// ── Searching ───────────────────────────────────────────────────────────────

const listing = (id, o = {}) => ({
  id,
  title: o.title ?? `Listing ${id}`,
  type: o.type ?? 'Apartment',
  transaction: o.transaction ?? 'For Sale',
  price: o.price ?? 0,
  rent: o.rent ?? 0,
  city: o.city ?? 'Mazraat Yachouh',
  district: o.district ?? '',
  beds: o.beds ?? 2,
  baths: 2,
  size: 150,
  status: o.status ?? 'Available',
  amenities: [],
  buildingFeatures: [],
  agentId: 'DH-585',
})

test('a rental enquiry never comes back full of sales', async () => {
  await loadAreas()
  const brief = briefFromIntent({
    intent: 'query_property',
    budget: 600,
    locations: ['Mazraat Yachouh'],
    fields: { transaction: 'For Rent', type: 'apartment', beds: 2 },
  })
  const stock = [
    listing(153, { transaction: 'For Sale', price: 375000, city: 'Rabweh' }),
    listing(154, { transaction: 'For Sale', price: 340000, city: 'Rabweh' }),
    listing(300, { transaction: 'For Rent', rent: 600 }),
    listing(301, { transaction: 'For Rent', rent: 650 }),
  ]
  const hits = searchBrief(brief, stock, null)
  // The exact failure in the screenshot: #153 and #154 must not be here.
  assert.deepEqual(hits.map(h => h.property.id).sort(), [300, 301])
  assert.ok(hits.every(h => h.property.transaction === 'For Rent'))
})

test('a 100% match has to earn it', async () => {
  await loadAreas()
  const brief = briefFromIntent({
    intent: 'query_property',
    budget: 600,
    locations: ['Mazraat Yachouh'],
    fields: { transaction: 'For Rent', type: 'apartment', beds: 2 },
  })
  // Right deal and area, but one bedroom short and 25% over budget.
  const [hit] = searchBrief(brief, [listing(9, { transaction: 'For Rent', rent: 750, beds: 1 })], null)
  assert.ok(hit, 'should still be offered')
  assert.ok(hit.score.total < 100, `scored ${hit.score.total} — the old bug was everything at 100%`)
})

test('with no transaction given, both sides are searched', async () => {
  await loadAreas()
  const brief = briefFromIntent({
    intent: 'query_property', budget: 600, locations: ['Mazraat Yachouh'], fields: { type: 'apartment' },
  })
  const hits = searchBrief(brief, [
    listing(1, { transaction: 'For Rent', rent: 600 }),
    listing(2, { transaction: 'For Sale', price: 620 }),
  ], null)
  assert.deepEqual(hits.map(h => h.property.id).sort(), [1, 2])
})

test('a brief with nothing in it matches nothing, rather than everything', () => {
  const brief = briefFromIntent({ intent: 'query_property' })
  assert.deepEqual(searchBrief(brief, [listing(1), listing(2)], null), [])
})

// ── What the agent reads ────────────────────────────────────────────────────

test('the reply says what was searched for, so a wrong read is visible', () => {
  // The whole reason the live bug went unnoticed: "5 matches for USD 370,740"
  // was the only clue, and it looked like an answer.
  const brief = briefFromIntent({
    intent: 'query_property', budget: 600,
    locations: ['Mazraat Yachouh', 'Ain Aar'],
    fields: { transaction: 'For Rent', type: 'apartment', beds: 2 },
  })
  const said = describeBrief(brief)
  assert.match(said, /2-bed Apartment/)
  assert.match(said, /to rent/)
  assert.match(said, /Mazraat Yachouh or Ain Aar/)
  assert.match(said, /600/)
})

test('a long list of areas is summarised, not dumped', () => {
  const brief = briefFromIntent({
    intent: 'query_property',
    locations: ['Mazraat Yachouh', 'Ain Aar', 'Beit el Chaar', 'Dik el Mehdi', 'Aatchaneh'],
    fields: { type: 'apartment' },
  })
  assert.match(describeBrief(brief), /Mazraat Yachouh, Ain Aar \+3 more/)
})

test('every match carries a link the agent can tap', () => {
  const lines = matchLines(
    [{ property: listing(153, { transaction: 'For Rent', rent: 600 }), score: { total: 87.4 } }],
    'https://stategen.app',
  )
  assert.match(lines[0], /#153/)
  assert.match(lines[0], /USD 600\/mo/)
  assert.match(lines[0], /87% match/)
  assert.match(lines[0], /https:\/\/stategen\.app\/properties\?open=153/)
})

test('no origin configured still produces a usable line', () => {
  const line = listingLines(listing(7, { price: 250000 }), '')
  assert.match(line, /#7/)
  assert.equal(line.includes('http'), false)
  assert.equal(line.includes('undefined'), false)
})

// ── Recognising a phone number at all ───────────────────────────────────────
// The second half of the live bug. A forwarded enquiry is meant to be excluded
// from the property-search fast path by looksLikeClientEnquiry(), which keyed
// on a phone — but its pattern demanded a space or a dash between the groups,
// so "81/370740" was not a phone to it. The message was claimed as a search,
// the budget came out of the phone, and the guard on the model's reply never
// ran because the model was never called.

test('a phone is a phone however it is punctuated', () => {
  for (const t of [
    '81/370740',
    'Maya bejjany\n81/370740\nLooking for an apartment',
    '03 445 210', '71 998 877', '01 234 567',
    '71998877', '+961 3 870 377', '00961 3 870 377',
    '70-123456', '(03) 445.210',
  ]) assert.equal(containsPhoneNumber(t), true, t)
})

test('prices, sizes and years are not phone numbers', () => {
  for (const t of [
    '350000', 'budget 500k in Achrafieh', '2 bedrooms 150 m2',
    '600$ per month', 'built in 2019', '#143', '',
    'what matches 500000 in Beirut',
  ]) assert.equal(containsPhoneNumber(t), false, t)
})
