// Unit tests for WhatsApp connect/opt-out helpers (src/lib/whatsapp/pairing.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generatePairingCode, normalizeCode, parseConnect, connectText, connectLink,
  isStopMessage, pairingExpired, PAIRING_CODE_LENGTH,
} from './pairing.ts'

test('generatePairingCode: right length, unambiguous alphabet, random', () => {
  const a = generatePairingCode()
  assert.equal(a.length, PAIRING_CODE_LENGTH)
  assert.match(a, /^[A-HJ-NP-Z2-9]+$/)          // no O/0/I/1/L
  // Overwhelmingly unlikely to collide across 20 draws.
  const set = new Set(Array.from({ length: 20 }, () => generatePairingCode()))
  assert.ok(set.size > 15)
})

test('normalizeCode: uppercases and strips noise', () => {
  assert.equal(normalizeCode(' k7m-2q9 '), 'K7M2Q9')
  assert.equal(normalizeCode(null), '')
})

test('parseConnect: reads the code out of a connect message', () => {
  assert.equal(parseConnect('connect K7M2Q9'), 'K7M2Q9')
  assert.equal(parseConnect('CONNECT k7m2q9'), 'K7M2Q9')
  assert.equal(parseConnect('connect: K7M2Q9'), 'K7M2Q9')
  assert.equal(parseConnect('Connect  k7m 2q9'), 'K7M2Q9')   // stray space
})
test('parseConnect: rejects non-connect messages and too-short codes', () => {
  assert.equal(parseConnect('hello'), null)
  assert.equal(parseConnect('K7M2Q9'), null)         // needs the word "connect"
  assert.equal(parseConnect('connect ab'), null)     // too short
  assert.equal(parseConnect(''), null)
  assert.equal(parseConnect(undefined), null)
})

test('connectText / connectLink build the deep link', () => {
  assert.equal(connectText('K7M2Q9'), 'connect K7M2Q9')
  const link = connectLink('whatsapp:+1 415 523 8886', 'K7M2Q9')
  assert.equal(link, 'https://wa.me/14155238886?text=connect%20K7M2Q9')
})

test('isStopMessage: only explicit opt-out words, whole message', () => {
  for (const s of ['stop', 'STOP', 'Unsubscribe', 'opt out', 'opt-out', 'stop all']) {
    assert.equal(isStopMessage(s), true, s)
  }
  for (const s of ['stop the meeting', 'cancel', 'please stop by', 'stopwatch']) {
    assert.equal(isStopMessage(s), false, s)
  }
})

test('pairingExpired: null/past expired, future valid', () => {
  assert.equal(pairingExpired(null), true)
  assert.equal(pairingExpired(new Date(Date.now() - 1000).toISOString()), true)
  assert.equal(pairingExpired(new Date(Date.now() + 60_000).toISOString()), false)
})
