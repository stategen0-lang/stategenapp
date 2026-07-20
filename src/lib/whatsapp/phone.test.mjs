// Unit tests for WhatsApp phone normalisation (src/lib/whatsapp/phone.ts).
// This is how the bot identifies an agent, so the edge cases matter.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, samePhone, isValidPhone, toWhatsAppAddress } from './phone.ts'

const E164 = '+9613870377'

// ── the formats this app actually produces ──────────────────────────────────
test('normalizePhone: Twilio "whatsapp:" address', () => {
  assert.equal(normalizePhone('whatsapp:+9613870377'), E164)
  assert.equal(normalizePhone('WhatsApp:+9613870377'), E164)
})

test('normalizePhone: spaced format used in seeded client records', () => {
  assert.equal(normalizePhone('+961 3 870 377'), E164)
  assert.equal(normalizePhone('+961 70 988 395'), '+96170988395')
})

test('normalizePhone: national format with the trunk zero', () => {
  assert.equal(normalizePhone('03 870 377'), E164)
  assert.equal(normalizePhone('03870377'), E164)
})

test('normalizePhone: bare national number without a leading zero', () => {
  assert.equal(normalizePhone('3870377'), E164)
  assert.equal(normalizePhone('70988395'), '+96170988395')
})

test('normalizePhone: "00" international prefix', () => {
  assert.equal(normalizePhone('009613870377'), E164)
})

test('normalizePhone: already carries the country code, no plus', () => {
  assert.equal(normalizePhone('9613870377'), E164)
})

test('normalizePhone: punctuation is ignored', () => {
  assert.equal(normalizePhone('+961-3-870-377'), E164)
  assert.equal(normalizePhone('(+961) 3 870 377'), E164)
  assert.equal(normalizePhone('  +961 3 870 377  '), E164)
})

test('normalizePhone: empty / junk input', () => {
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone(null), '')
  assert.equal(normalizePhone(undefined), '')
  assert.equal(normalizePhone('not a phone'), '')
})

test('normalizePhone: honours a different country code', () => {
  assert.equal(normalizePhone('020 7946 0958', '44'), '+442079460958')
  assert.equal(normalizePhone('+1 415 555 0132', '44'), '+14155550132') // explicit + wins
})

// ── comparison ──────────────────────────────────────────────────────────────
test('samePhone: matches across every written form', () => {
  assert.equal(samePhone('whatsapp:+9613870377', '+961 3 870 377'), true)
  assert.equal(samePhone('03 870 377', '+9613870377'), true)
  assert.equal(samePhone('3870377', '009613870377'), true)
})

test('samePhone: different numbers do not match', () => {
  assert.equal(samePhone('+9613870377', '+96170988395'), false)
})

test('samePhone: empty never matches, not even another empty', () => {
  assert.equal(samePhone('', ''), false)
  assert.equal(samePhone(null, '+9613870377'), false)
})

// ── validation ──────────────────────────────────────────────────────────────
test('isValidPhone: plausible vs implausible', () => {
  assert.equal(isValidPhone('+961 3 870 377'), true)
  assert.equal(isValidPhone('whatsapp:+9613870377'), true)
  assert.equal(isValidPhone('123'), false)     // too short even with country code
  assert.equal(isValidPhone(''), false)
})

// ── outbound address ────────────────────────────────────────────────────────
test('toWhatsAppAddress: formats for Twilio, blank stays blank', () => {
  assert.equal(toWhatsAppAddress('03 870 377'), 'whatsapp:+9613870377')
  assert.equal(toWhatsAppAddress(''), '')
})
