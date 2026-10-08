// Unit tests for intent JSON parsing (src/lib/whatsapp/intent.ts).
// The model call itself isn't tested here; the parsing is the part that breaks.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIntentJson, withoutPhoneBudget } from './intent.ts'

test('parseIntentJson: clean JSON object', () => {
  const r = parseIntentJson('{"intent":"query_client","clientName":"Ahmed"}')
  assert.equal(r.intent, 'query_client')
  assert.equal(r.clientName, 'Ahmed')
})

test('parseIntentJson: strips markdown code fences', () => {
  const r = parseIntentJson('```json\n{"intent":"help"}\n```')
  assert.equal(r.intent, 'help')
})

test('parseIntentJson: ignores prose wrapped around the object', () => {
  const r = parseIntentJson('Sure! Here is the result:\n{"intent":"query_property","budget":500000}\nHope that helps.')
  assert.equal(r.intent, 'query_property')
  assert.equal(r.budget, 500000)
})

test('parseIntentJson: unrecognised intent falls back to unknown', () => {
  assert.equal(parseIntentJson('{"intent":"launch_rocket"}').intent, 'unknown')
})

test('parseIntentJson: malformed or empty input never throws', () => {
  assert.equal(parseIntentJson('{not json').intent, 'unknown')
  assert.equal(parseIntentJson('').intent, 'unknown')
  assert.equal(parseIntentJson(null).intent, 'unknown')
  assert.equal(parseIntentJson('no object at all').intent, 'unknown')
})

test('parseIntentJson: numeric coercion for propertyId and budget', () => {
  const r = parseIntentJson('{"intent":"update_property","propertyId":"23","budget":"400000"}')
  assert.equal(r.propertyId, 23)
  assert.equal(r.budget, 400000)
})

test('parseIntentJson: drops non-positive or non-numeric ids and budgets', () => {
  const r = parseIntentJson('{"intent":"query_property","propertyId":"abc","budget":0}')
  assert.equal(r.propertyId, undefined)
  assert.equal(r.budget, undefined)
})

test('parseIntentJson: keeps update fields', () => {
  const r = parseIntentJson('{"intent":"update_client","clientName":"Ahmed","fields":{"budget":400000}}')
  assert.deepEqual(r.fields, { budget: 400000 })
})

test('parseIntentJson: keeps a forwarded enquiry’s create_client fields', () => {
  // A forwarded client message the model classified as a new lead — every
  // extracted field must survive parsing so the client form can be seeded.
  const r = parseIntentJson('{"intent":"create_client","fields":{"name":"Joe Khoury","clientType":"buyer","propertyType":"apartment","location":"Achrafieh","budget":250000,"beds":2,"phone":"03 123456"}}')
  assert.equal(r.intent, 'create_client')
  assert.deepEqual(r.fields, {
    name: 'Joe Khoury', clientType: 'buyer', propertyType: 'apartment',
    location: 'Achrafieh', budget: 250000, beds: 2, phone: '03 123456',
  })
})

test('parseIntentJson: ignores empty or non-object fields', () => {
  assert.equal(parseIntentJson('{"intent":"update_client","fields":{}}').fields, undefined)
  assert.equal(parseIntentJson('{"intent":"update_client","fields":[1,2]}').fields, undefined)
})

test('parseIntentJson: trims strings and drops blank ones', () => {
  const r = parseIntentJson('{"intent":"query_client","clientName":"  Ahmed  ","location":"   "}')
  assert.equal(r.clientName, 'Ahmed')
  assert.equal(r.location, undefined)
})

test('parseIntentJson: nested braces in a string value still parse', () => {
  const r = parseIntentJson('{"intent":"feedback","notes":"said {maybe} next week"}')
  assert.equal(r.intent, 'feedback')
  assert.equal(r.notes, 'said {maybe} next week')
})

// ── The model is not trusted with phone numbers ─────────────────────────────
// It is told not to read a budget out of one, and it did anyway: a forwarded
// enquiry whose client phone was "81/370740" came back as a search for listings
// at USD 370,740. The guard runs on every classification.

const FORWARDED = `Maya bejjany
81/370740
Looking for an apartment for rent
2 bedrooms
600$ per month`

test('withoutPhoneBudget: a budget taken from the phone is dropped', () => {
  const r = withoutPhoneBudget({ intent: 'query_property', budget: 370740 }, FORWARDED)
  assert.equal('budget' in r, false)
  assert.equal(r.intent, 'query_property')   // everything else survives
})

test('withoutPhoneBudget: the real budget is left alone', () => {
  const r = withoutPhoneBudget({ intent: 'query_property', budget: 600 }, FORWARDED)
  assert.equal(r.budget, 600)
})

test('withoutPhoneBudget: nothing to do without a budget', () => {
  const intent = { intent: 'query_client', clientName: 'Maya' }
  assert.deepEqual(withoutPhoneBudget(intent, FORWARDED), intent)
})

test('parseIntentJson: several areas come through', () => {
  const r = parseIntentJson('{"intent":"query_property","locations":["Jounieh","Kaslik"," "],"budget":800}')
  assert.deepEqual(r.locations, ['Jounieh', 'Kaslik'])
  assert.equal(r.budget, 800)
})
