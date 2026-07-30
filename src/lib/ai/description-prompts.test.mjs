// Unit tests for AI description prompt building (src/lib/ai/description-prompts.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFacts, buildPrompts } from './description-prompts.ts'

const sale = {
  title: '3 bed apartment', type: 'Appartement', transaction: 'For Sale',
  price: 450000, district: 'Hamra', city: 'Beirut', size: 180, beds: 3, baths: 2,
  parkings: 1, view: 'sea view',
}

test('buildFacts: includes known values, drops unknown ones', () => {
  const f = buildFacts(sale)
  assert.match(f, /Property type: Appartement/)
  assert.match(f, /Price: USD 450,000/)
  assert.match(f, /Size: 180 m²/)
  assert.match(f, /Parking spaces: 1/)
  // No balcony/garden provided → not mentioned.
  assert.equal(/balcony|garden/i.test(f), false)
})
test('buildFacts: rent uses the /month price', () => {
  const f = buildFacts({ ...sale, transaction: 'For Rent', rent: 1200, price: undefined })
  assert.match(f, /Price: USD 1,200\/month/)
  assert.match(f, /rental/)
})

test('free-form mode (no template): short copy, small token budget', () => {
  const p = buildPrompts(sale)
  assert.equal(p.maxTokens, 300)
  assert.equal(p.temperature, 0.7)
  assert.match(p.prompt, /2-3 sentences only/)
  assert.equal(/BEGIN TEMPLATE/.test(p.prompt), false)
})
test('template mode: reproduces the template, generous token budget', () => {
  const template = 'Rental Price: $ [AMOUNT] /month\n[X] Bedroom(s)'
  const p = buildPrompts(sale, template)
  assert.equal(p.maxTokens, 4000)          // reasoning tokens need room
  assert.equal(p.temperature, 0.4)
  assert.match(p.prompt, /BEGIN TEMPLATE/)
  assert.match(p.prompt, /\[AMOUNT\]/)     // the template is embedded verbatim
  assert.match(p.prompt, /No square brackets may remain/)
})
test('a blank/whitespace template falls back to free-form', () => {
  assert.equal(buildPrompts(sale, '   ').maxTokens, 300)
  assert.equal(buildPrompts(sale, null).maxTokens, 300)
})
