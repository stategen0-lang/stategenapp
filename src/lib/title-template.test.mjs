// Unit tests for listing titles written from the agency's template. Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTitle, unknownTokens, DEFAULT_TITLE_TEMPLATE, TITLE_FIELDS, sizeUnitOf, setSizeUnit } from './title-template.ts'

// The template the agency asked for.
const HOUSE = '[furnished or nothing][size][type][for sale/ rent][location]'

const flat = {
  type: 'Apartment', transaction: 'For Sale', location: 'Kaslik',
  size: 180, beds: 3, baths: 2, parkings: 2, furnishing: 'Furnished',
  view: 'Sea', floor: 'Mid floor', price: 450000, rent: 0, buildingAge: 5,
}

test('the agency template, filled in', () => {
  assert.equal(renderTitle(HOUSE, flat), 'Furnished 180 m² Apartment for sale Kaslik')
})

test('"or nothing": an unfurnished listing simply omits it', () => {
  assert.equal(renderTitle(HOUSE, { ...flat, furnishing: 'Unfurnished' }), '180 m² Apartment for sale Kaslik')
  assert.equal(renderTitle(HOUSE, { ...flat, furnishing: '' }), '180 m² Apartment for sale Kaslik')
  assert.equal(renderTitle(HOUSE, { ...flat, furnishing: 'Semi-furnished' }), 'Semi-furnished 180 m² Apartment for sale Kaslik')
})

test('a rental says "for rent"', () => {
  assert.equal(renderTitle(HOUSE, { ...flat, transaction: 'For Rent' }), 'Furnished 180 m² Apartment for rent Kaslik')
})

test('missing fields disappear, and so does the wording around them', () => {
  assert.equal(renderTitle(DEFAULT_TITLE_TEMPLATE, flat), 'Furnished 180 m² Apartment for sale in Kaslik')
  // No area: the trailing "in" must go too.
  assert.equal(renderTitle(DEFAULT_TITLE_TEMPLATE, { ...flat, location: '' }), 'Furnished 180 m² Apartment for sale')
  // No size either.
  assert.equal(renderTitle(DEFAULT_TITLE_TEMPLATE, { ...flat, location: '', size: 0 }), 'Furnished Apartment for sale')
  // Nothing at all to say.
  assert.equal(renderTitle(DEFAULT_TITLE_TEMPLATE, {}), '')
})

test('other fields a manager might use', () => {
  assert.equal(renderTitle('[beds] [type] with [view] in [location]', flat), '3 beds Apartment with Sea view in Kaslik')
  assert.equal(renderTitle('[beds]-bed [type], [floor], [parking]', flat), '3 beds-bed Apartment, Mid floor, 2 parkings')
  assert.equal(renderTitle('[type] in [location] — [price]', flat), 'Apartment in Kaslik — $450,000')
  assert.equal(renderTitle('[type] in [location] — [rent]', { ...flat, transaction: 'For Rent', price: 0, rent: 1200 }), 'Apartment in Kaslik — $1,200/mo')
  assert.equal(renderTitle('[baths] [building age] [type]', flat), '2 baths 5 years old Apartment')
  // One bed, not "1 beds".
  assert.equal(renderTitle('[beds] [type]', { ...flat, beds: 1 }), '1 bed Apartment')
})

test('token wording is forgiving', () => {
  for (const token of ['[location]', '[Location]', '[ area ]', '[city]', '[neighbourhood]']) {
    assert.equal(renderTitle(`[type] ${token}`, flat), 'Apartment Kaslik', token)
  }
  for (const token of ['[for sale/rent]', '[for sale / rent]', '[transaction]', '[Sale or Rent]']) {
    assert.equal(renderTitle(`[type] ${token}`, flat), 'Apartment for sale', token)
  }
})

test('plain text outside brackets is kept as written', () => {
  assert.equal(renderTitle('Prime [type] in [location]!', flat), 'Prime Apartment in Kaslik!')
})

test('an empty or unset template falls back to the default', () => {
  assert.equal(renderTitle('', flat), 'Furnished 180 m² Apartment for sale in Kaslik')
  assert.equal(renderTitle(null, flat), 'Furnished 180 m² Apartment for sale in Kaslik')
  assert.equal(renderTitle(undefined, flat), 'Furnished 180 m² Apartment for sale in Kaslik')
})

test('a token nobody recognises is dropped, and reported', () => {
  assert.equal(renderTitle('[type] [owner name] in [location]', flat), 'Apartment in Kaslik')
  assert.deepEqual(unknownTokens('[type] [owner name] in [location]'), ['[owner name]'])
  assert.deepEqual(unknownTokens(HOUSE), [])
  assert.deepEqual(unknownTokens(DEFAULT_TITLE_TEMPLATE), [])
})

test('the help list covers the agency template\'s fields', () => {
  const tokens = TITLE_FIELDS.map(f => f.token)
  for (const t of ['[furnished]', '[size]', '[type]', '[for sale/rent]', '[location]']) {
    assert.ok(tokens.includes(t), `${t} should be offered in settings`)
  }
})

// ── Size unit ───────────────────────────────────────────────────────────────
// Lebanese listings say SQM far more often than m², so the pattern itself
// carries the choice. Both tokens write the same number.

test('[size sqm] writes the unit the way listings here write it', () => {
  assert.equal(renderTitle('[size][type] in [location]', flat), '180 m² Apartment in Kaslik')
  assert.equal(renderTitle('[size sqm][type] in [location]', flat), '180 SQM Apartment in Kaslik')
  // Spacing and punctuation inside the brackets are ignored, as everywhere else.
  assert.equal(renderTitle('[SQM] [type]', flat), '180 SQM Apartment')
  assert.equal(renderTitle('[area sqm] [type]', flat), '180 SQM Apartment')
  // It disappears with the wording around it when there is no size.
  assert.equal(renderTitle('[size sqm][type] in [location]', { ...flat, size: 0 }), 'Apartment in Kaslik')
  // And the m² token is untouched by any of this.
  assert.equal(renderTitle('[m2] [type]', flat), '180 m² Apartment')
})

test('both size tokens are offered in settings, and neither reads as unknown', () => {
  const tokens = TITLE_FIELDS.map(f => f.token)
  assert.ok(tokens.includes('[size]'))
  assert.ok(tokens.includes('[size sqm]'))
  assert.deepEqual(unknownTokens('[size sqm] [sqm] [m2]'), [])
})

test('the unit a pattern asks for', () => {
  assert.equal(sizeUnitOf('[size][type]'), 'm2')
  assert.equal(sizeUnitOf('[size sqm][type]'), 'sqm')
  assert.equal(sizeUnitOf('[sqm][type]'), 'sqm')
  assert.equal(sizeUnitOf('[type] in [location]'), null)   // no size at all
  assert.equal(sizeUnitOf(''), 'm2')                       // the default pattern's
  assert.equal(sizeUnitOf(null), 'm2')
})

test('switching the unit rewrites the pattern and leaves the rest alone', () => {
  assert.equal(setSizeUnit(HOUSE, 'sqm'), '[furnished or nothing][size sqm][type][for sale/ rent][location]')
  assert.equal(setSizeUnit('[size sqm][type] in [location]', 'm2'), '[size][type] in [location]')
  // Switching twice comes back to where it started.
  assert.equal(setSizeUnit(setSizeUnit(HOUSE, 'sqm'), 'm2'), '[furnished or nothing][size][type][for sale/ rent][location]')
  // Nothing to switch: unchanged.
  assert.equal(setSizeUnit('[type] in [location]', 'sqm'), '[type] in [location]')
  // An unknown token is left exactly as the manager wrote it.
  assert.equal(setSizeUnit('[size] [owner name]', 'sqm'), '[size sqm] [owner name]')
  // And the rewritten pattern renders in the new unit.
  assert.equal(renderTitle(setSizeUnit(HOUSE, 'sqm'), flat), 'Furnished 180 SQM Apartment for sale Kaslik')
})
