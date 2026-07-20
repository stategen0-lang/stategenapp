// Unit tests for intent JSON parsing (src/lib/whatsapp/intent.ts).
// The model call itself isn't tested here; the parsing is the part that breaks.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIntentJson } from './intent.ts'

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
