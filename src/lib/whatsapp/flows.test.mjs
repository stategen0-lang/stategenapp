// Unit tests for the multi-step listing flow (src/lib/whatsapp/flows.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CREATE_PROPERTY_STEPS, nextStep, isComplete, applyAnswer,
  seedContext, progress, derivedTitle, isStartListing,
  coerceType, extrasOf, answersOf, EXTRA_KEY,
} from './flows.ts'

// ── Property type, as people actually write it ──────────────────────────────
// From a real session: the agent answered "Apartment" and was told the type
// wasn't recognised, because the app stores the French "Appartement".
test('coerceType: accepts the English spelling', () => {
  assert.equal(coerceType('Apartment'), 'Appartement')
  assert.equal(coerceType('apartment'), 'Appartement')
  assert.equal(coerceType('appartment'), 'Appartement')
  assert.equal(coerceType('flat'), 'Appartement')
  assert.equal(coerceType('apt'), 'Appartement')
})
test('coerceType: still accepts the canonical spellings', () => {
  for (const t of ['Appartement', 'Villa', 'Office', 'Shop', 'Land', 'Chalet', 'Building']) {
    assert.equal(coerceType(t), t)
    assert.equal(coerceType(t.toLowerCase()), t)
  }
})
test('coerceType: other common words', () => {
  assert.equal(coerceType('house'), 'Villa')
  assert.equal(coerceType('store'), 'Shop')
  assert.equal(coerceType('plot'), 'Land')
})
test('coerceType: finds the type inside a longer answer', () => {
  assert.equal(coerceType('a 3 bed apartment'), 'Appartement')
  assert.equal(coerceType('its a villa'), 'Villa')
})
test('coerceType: rejects what genuinely is not a type', () => {
  assert.equal(coerceType('spaceship'), null)
  assert.equal(coerceType(''), null)
  assert.equal(coerceType(null), null)
})

// ── Details volunteered but never asked about ───────────────────────────────
test('seedContext: keeps fields the flow does not ask about', () => {
  // Real case: "3 bed 3 bath 2 parking 140sqm" saved only the bedrooms.
  const ctx = seedContext({ beds: 3, baths: 3, size: 140, parkings: 2 })
  assert.equal(ctx.beds, 3)
  assert.deepEqual(extrasOf(ctx), { baths: 3, size: 140 })
})
test('extras do not count as answered questions', () => {
  const ctx = seedContext({ beds: 3, baths: 2 })
  assert.equal(nextStep(ctx).key, 'type')          // still asks the unanswered ones
  assert.equal(EXTRA_KEY in answersOf(ctx), false)
})
test('extras do not inflate the progress counter', () => {
  const ctx = seedContext({ beds: 3, baths: 2, size: 140 })
  assert.equal(progress(ctx), `(1/${CREATE_PROPERTY_STEPS.length})`)
})
test('seedContext: no extras means no extras key', () => {
  assert.equal(EXTRA_KEY in seedContext({ beds: 3 }), false)
  assert.deepEqual(extrasOf(seedContext({ beds: 3 })), {})
})
test('answersOf / extrasOf tolerate a missing or malformed bag', () => {
  assert.deepEqual(extrasOf({}), {})
  assert.deepEqual(extrasOf({ [EXTRA_KEY]: 'oops' }), {})
  assert.deepEqual(answersOf({ beds: 3 }), { beds: 3 })
})

// ── Starting the flow without a model round-trip ────────────────────────────
test('isStartListing: recognises the obvious phrasings', () => {
  for (const s of [
    'add a listing', 'add listing', 'Add a new listing',
    'I want to add a new listing', 'create a property',
    'add a villa in Hamra', 'list a new apartment',
    'add listing: 3 bed apartment in Hamra, 450k',
  ]) assert.ok(isStartListing(s), `should match: ${s}`)
})
test('isStartListing: does not swallow unrelated messages', () => {
  for (const s of [
    'what properties match 500k in Beirut', 'info on Ahmed',
    'mark property #23 as sold', 'done', 'help', '',
    "set Ahmed's budget to 400k",
  ]) assert.equal(isStartListing(s), false, `should not match: ${s}`)
})

const stepFor = (key) => CREATE_PROPERTY_STEPS.find(s => s.key === key)

const full = {
  type: 'Appartement', transaction: 'For Sale', location: 'Beirut',
  neighborhood: 'Hamra', price: 450000, beds: 3,
  ownerName: 'Mr Khoury', ownerContact: '03111222',
}

// ── Step order ──────────────────────────────────────────────────────────────
test('covers the fields the spec requires', () => {
  const keys = CREATE_PROPERTY_STEPS.map(s => s.key)
  for (const required of ['type', 'location', 'price', 'beds', 'ownerName', 'ownerContact']) {
    assert.ok(keys.includes(required), `missing required field: ${required}`)
  }
})
test('nextStep: walks the steps in order', () => {
  assert.equal(nextStep({}).key, 'type')
  assert.equal(nextStep({ type: 'Villa' }).key, 'transaction')
})
test('nextStep: returns null once everything is collected', () => {
  assert.equal(nextStep(full), null)
  assert.equal(isComplete(full), true)
})
test('nextStep: a zero value counts as answered', () => {
  // "0 bedrooms" is a real answer for land or a shop, not a missing field.
  const ctx = { ...full, beds: 0 }
  assert.equal(isComplete(ctx), true)
})

// ── Answers ─────────────────────────────────────────────────────────────────
test('applyAnswer: stores a valid answer', () => {
  const r = applyAnswer(stepFor('type'), 'villa', {})
  assert.equal(r.error, undefined)
  assert.equal(r.context.type, 'Villa')      // canonical spelling
})
test('applyAnswer: rejects a bad answer and leaves the context untouched', () => {
  const r = applyAnswer(stepFor('price'), 'expensive', { type: 'Villa' })
  assert.ok(r.error)
  assert.deepEqual(r.context, { type: 'Villa' })
})
test('applyAnswer: understands money shorthand', () => {
  assert.equal(applyAnswer(stepFor('price'), '450k', {}).context.price, 450000)
  assert.equal(applyAnswer(stepFor('price'), '$1.2m', {}).context.price, 1_200_000)
})
test('applyAnswer: transaction accepts natural phrasing', () => {
  assert.equal(applyAnswer(stepFor('transaction'), 'for rent', {}).context.transaction, 'For Rent')
  assert.equal(applyAnswer(stepFor('transaction'), 'rent', {}).context.transaction, 'For Rent')
  assert.equal(applyAnswer(stepFor('transaction'), 'selling it', {}).context.transaction, 'For Sale')
})
test('applyAnswer: zero bedrooms is accepted, not treated as a failure', () => {
  const r = applyAnswer(stepFor('beds'), '0', {})
  assert.equal(r.error, undefined)
  assert.equal(r.context.beds, 0)
})

// ── Seeding from the opening message ────────────────────────────────────────
test('seedContext: pre-fills what the first message already contained', () => {
  const ctx = seedContext({ type: 'Villa', price: '450k', location: 'Beirut' })
  assert.equal(ctx.type, 'Villa')
  assert.equal(ctx.price, 450000)
  assert.equal(nextStep(ctx).key, 'transaction')   // type already known, skipped
})
test('seedContext: maps the aliases the model tends to emit', () => {
  const ctx = seedContext({ bedrooms: 3, district: 'Hamra', city: 'Beirut', owner: 'Mr K' })
  assert.equal(ctx.beds, 3)
  assert.equal(ctx.neighborhood, 'Hamra')
  assert.equal(ctx.location, 'Beirut')
  assert.equal(ctx.ownerName, 'Mr K')
})
test('seedContext: silently drops values that will not parse', () => {
  const ctx = seedContext({ price: 'negotiable', type: 'Spaceship' })
  assert.equal(ctx.price, undefined)
  assert.equal(ctx.type, undefined)
})
test('seedContext: ignores fields that are not part of the flow', () => {
  const ctx = seedContext({ company_id: 99, id: 5 })
  assert.deepEqual(ctx, {})
})
test('seedContext: no fields yields an empty context', () => {
  assert.deepEqual(seedContext(undefined), {})
})

// ── Presentation ────────────────────────────────────────────────────────────
test('progress: counts collected fields', () => {
  assert.equal(progress({}), `(0/${CREATE_PROPERTY_STEPS.length})`)
  assert.equal(progress(full), `(${CREATE_PROPERTY_STEPS.length}/${CREATE_PROPERTY_STEPS.length})`)
})
test('derivedTitle: builds a readable title', () => {
  assert.equal(derivedTitle(full), '3 bed Appartement in Hamra')
})
test('derivedTitle: omits bedrooms when there are none', () => {
  assert.equal(derivedTitle({ ...full, beds: 0 }), 'Office in Hamra'.replace('Office', 'Appartement'))
})
