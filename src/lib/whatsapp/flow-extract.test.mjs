// Unit tests for the conversational field extractor's JSON parsing. Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFieldsJson } from './flow-extract.ts'

test('parseFieldsJson: reads the wrapped {"fields":{…}} shape', () => {
  const f = parseFieldsJson('{"fields":{"price":500000,"type":"apartment"}}')
  assert.deepEqual(f, { price: 500000, type: 'apartment' })
})

test('parseFieldsJson: accepts a flat object without the wrapper', () => {
  assert.deepEqual(parseFieldsJson('{"price":450000}'), { price: 450000 })
})

test('parseFieldsJson: strips code fences and surrounding prose', () => {
  const raw = 'Sure!\n```json\n{"fields":{"beds":3}}\n```'
  assert.deepEqual(parseFieldsJson(raw), { beds: 3 })
})

test('parseFieldsJson: keeps only string/number/boolean values', () => {
  const f = parseFieldsJson('{"fields":{"type":"villa","beds":4,"garden":true,"junk":[1,2],"obj":{"a":1},"blank":"  "}}')
  assert.deepEqual(f, { type: 'villa', beds: 4, garden: true })
})

test('parseFieldsJson: trims strings', () => {
  assert.deepEqual(parseFieldsJson('{"fields":{"location":"  Beirut "}}'), { location: 'Beirut' })
})

test('parseFieldsJson: garbage / empty returns {}', () => {
  assert.deepEqual(parseFieldsJson('not json'), {})
  assert.deepEqual(parseFieldsJson(''), {})
  assert.deepEqual(parseFieldsJson(null), {})
  assert.deepEqual(parseFieldsJson('{"fields":{}}'), {})
})
