// Unit tests for AI description prompt building (src/lib/ai/description-prompts.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripTemplateMarkers, buildFacts, buildPrompts, buildArabicPrompts, hasArabic } from './description-prompts.ts'

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

// ── The area, not the country ───────────────────────────────────────────────
test('the facts give the area alone, and both modes forbid adding a country', () => {
  const d = { type: 'Appartement', transaction: 'For Sale', price: 120000, district: '', city: 'ashrafieh', size: 60 }
  const facts = buildFacts(d)
  assert.match(facts, /Location[^\n]*ashrafieh/)
  assert.equal(/Lebanon/.test(facts), false)        // it used to append ", Lebanon"
  for (const p of [buildPrompts(d), buildPrompts(d, 'A [Property Type] in [Location]')]) {
    assert.match(p.prompt, /never "in Ashrafieh, Lebanon"/)
  }
})

// ── The template markers must never reach the listing ───────────────────────
test('template mode tells the model not to echo the markers', () => {
  const p = buildPrompts({ type: 'Appartement' }, 'A [Property Type] in [Location]')
  assert.match(p.prompt, /Never output the "--- BEGIN TEMPLATE ---"/)
})

test('stripTemplateMarkers: removes what the model echoed (the real case)', () => {
  const echoed = [
    '--- BEGIN TEMPLATE ---',
    'Own This Furnished Appartement for Sale in Ashrafieh!',
    'A beautifully designed 60 sqm appartement…',
    '--- END TEMPLATE ---',
  ].join('\n')
  assert.equal(
    stripTemplateMarkers(echoed),
    'Own This Furnished Appartement for Sale in Ashrafieh!\nA beautifully designed 60 sqm appartement…',
  )
})

test('stripTemplateMarkers: handles one marker, odd spacing, or none at all', () => {
  assert.equal(stripTemplateMarkers('--- BEGIN TEMPLATE ---\nJust the copy.'), 'Just the copy.')
  assert.equal(stripTemplateMarkers('Just the copy.\n--- END TEMPLATE ---'), 'Just the copy.')
  assert.equal(stripTemplateMarkers('----  begin template  ----\nJust the copy.'), 'Just the copy.')
  // A clean description is returned untouched.
  const clean = 'Own This Furnished Appartement for Sale in Ashrafieh!\n\nFeatures:\nKitchen'
  assert.equal(stripTemplateMarkers(clean), clean)
  assert.equal(stripTemplateMarkers(''), '')
})

test('stripTemplateMarkers: a stray marker mid-text is dropped, the rest kept', () => {
  assert.equal(stripTemplateMarkers('Line one\n--- END TEMPLATE ---\n'), 'Line one')
})

// ── Public vs internal notes ────────────────────────────────────────────────
test('public notes are material for the copy; internal notes stay context', () => {
  const facts = buildFacts({
    type: 'Appartement', transaction: 'For Sale', price: 120000, city: 'Ashrafieh',
    publicNotes: 'Brand new kitchen, quiet street',
    notes: 'Owner is in a hurry, will drop 10k',
  })
  assert.match(facts, /include these in the description[^\n]*Brand new kitchen/)
  assert.match(facts, /never quote or reveal these[^\n]*Owner is in a hurry/)
})

test('both modes are told to use the selling points and hide the internal notes', () => {
  const d = { type: 'Appartement', publicNotes: 'New kitchen', notes: 'Owner desperate' }
  for (const p of [buildPrompts(d), buildPrompts(d, 'A [Property Type] in [Location]')]) {
    assert.match(p.prompt, /selling points/i)
    assert.match(p.prompt, /internal notes/i)
  }
})

test('a listing with no notes at all mentions neither', () => {
  const facts = buildFacts({ type: 'Villa', transaction: 'For Rent', rent: 1200, city: 'Adma' })
  assert.equal(/selling points/i.test(facts), false)
  assert.equal(/Agent notes/i.test(facts), false)
})

// ── The Arabic version ───────────────────────────────────────────────────────

test('buildArabicPrompts: carries the English, the facts, and the structure rule', () => {
  const { systemPrompt, prompt } = buildArabicPrompts(
    { type: 'Appartement', transaction: 'For Sale', price: 250000, district: 'Achrafieh', size: 180, beds: 3 },
    'Bright three-bedroom with sea views.',
  )
  assert.match(systemPrompt, /Modern Standard Arabic/)
  assert.ok(prompt.includes('Bright three-bedroom with sea views.'))
  assert.ok(prompt.includes('Achrafieh'))
  assert.match(prompt, /Keep the structure exactly/)
  // The rules that stop the two classic failures: a literal translation, and
  // the model answering in English.
  assert.match(prompt, /not a literal translation/)
  assert.match(prompt, /Output only the Arabic description/)
})

test('buildArabicPrompts: never leaks the internal notes', () => {
  const { prompt } = buildArabicPrompts(
    { type: 'Appartement', transaction: 'For Sale', price: 1, district: 'Hamra', notes: 'owner wants cash only' },
    'A flat.',
  )
  // The notes go in as context (same as the English prompt) but are fenced off.
  assert.match(prompt, /never quote or reveal/)
  assert.match(prompt, /Never repeat or hint at the agent's internal notes/)
})

test('hasArabic: tells an Arabic answer from an English one', () => {
  assert.equal(hasArabic('شقة مشرقة بإطلالة على البحر'), true)
  assert.equal(hasArabic('Bright apartment with sea views'), false)
  assert.equal(hasArabic(''), false)
  assert.equal(hasArabic(null), false)
  // A mixed line still counts — prices and m² stay in Latin script on purpose.
  assert.equal(hasArabic('شقة 180 م² بسعر 250,000$'), true)
})
