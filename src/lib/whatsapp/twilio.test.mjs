// Unit tests for Twilio request authentication (src/lib/whatsapp/twilio.ts).
// This is the security boundary for the bot, so it is tested against Twilio's
// own published example vector rather than only self-consistent output.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSignature, verifySignature, twimlMessage, twimlEmpty } from './twilio.ts'

// ── Twilio's canonical example, verbatim from twilio.com/docs/usage/security ─
const DOC_TOKEN = '12345'
const DOC_URL = 'https://example.com/myapp.php?foo=1&bar=2'
const DOC_PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675310',
  Digits: '1234',
  From: '+14158675310',
  To: '+18005551212',
}
const DOC_SIGNATURE = 'L/OH5YylLD5NRKLltdqwSvS0BnU='

test('buildSignature: matches Twilio\'s published example vector', () => {
  assert.equal(buildSignature(DOC_TOKEN, DOC_URL, DOC_PARAMS), DOC_SIGNATURE)
})

test('buildSignature: parameter order in the object does not matter', () => {
  const reordered = {
    To: '+18005551212',
    Digits: '1234',
    CallSid: 'CA1234567890ABCDE',
    From: '+14158675310',
    Caller: '+14158675310',
  }
  assert.equal(buildSignature(DOC_TOKEN, DOC_URL, reordered), DOC_SIGNATURE)
})

// ── verification ────────────────────────────────────────────────────────────
test('verifySignature: accepts a genuine signature', () => {
  assert.equal(verifySignature(DOC_TOKEN, DOC_SIGNATURE, DOC_URL, DOC_PARAMS), true)
})

test('verifySignature: rejects a forged signature', () => {
  assert.equal(verifySignature(DOC_TOKEN, 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=', DOC_URL, DOC_PARAMS), false)
})

test('verifySignature: rejects an added parameter', () => {
  assert.equal(verifySignature(DOC_TOKEN, DOC_SIGNATURE, DOC_URL, { ...DOC_PARAMS, Body: 'injected' }), false)
})

test('verifySignature: rejects a tampered From number (the impersonation case)', () => {
  const tampered = { ...DOC_PARAMS, From: '+96181056376' }
  assert.equal(verifySignature(DOC_TOKEN, DOC_SIGNATURE, DOC_URL, tampered), false)
})

test('verifySignature: rejects when the URL differs', () => {
  assert.equal(verifySignature(DOC_TOKEN, DOC_SIGNATURE, 'https://evil.example/hook', DOC_PARAMS), false)
})

test('verifySignature: rejects the wrong auth token', () => {
  assert.equal(verifySignature('wrong-token', DOC_SIGNATURE, DOC_URL, DOC_PARAMS), false)
})

test('verifySignature: rejects missing signature or token, never throws', () => {
  assert.equal(verifySignature(DOC_TOKEN, null, DOC_URL, DOC_PARAMS), false)
  assert.equal(verifySignature(DOC_TOKEN, '', DOC_URL, DOC_PARAMS), false)
  assert.equal(verifySignature('', DOC_SIGNATURE, DOC_URL, DOC_PARAMS), false)
})

test('verifySignature: mismatched length does not throw (timingSafeEqual guard)', () => {
  assert.equal(verifySignature(DOC_TOKEN, 'short', DOC_URL, DOC_PARAMS), false)
})

// ── TwiML ───────────────────────────────────────────────────────────────────
test('twimlMessage: wraps the body', () => {
  const xml = twimlMessage('Hello there')
  assert.ok(xml.includes('<Response><Message>Hello there</Message></Response>'))
})

test('twimlMessage: escapes XML so a message cannot break the envelope', () => {
  const xml = twimlMessage('Budget < 500k & "urgent" > rest')
  assert.ok(xml.includes('&lt;'))
  assert.ok(xml.includes('&amp;'))
  assert.ok(xml.includes('&quot;'))
  assert.ok(!xml.includes('<Message>Budget <'))
})

test('twimlMessage: preserves multi-line bodies', () => {
  assert.ok(twimlMessage('line one\nline two').includes('line one\nline two'))
})

test('twimlEmpty: valid empty response', () => {
  assert.ok(twimlEmpty().includes('<Response></Response>'))
})
