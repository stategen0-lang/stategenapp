// Unit tests for the WhatsApp Cloud API transport (src/lib/whatsapp/cloud.ts).
// Signature verification is the bot's security boundary, so it is tested against
// a digest computed independently from a known body + secret, plus tamper cases.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { verifyMetaSignature, parseInbound, toCloudAddress } from './cloud.ts'

// ── verifyMetaSignature ──────────────────────────────────────────────────────
const SECRET = 'test_app_secret'
const BODY = '{"object":"whatsapp_business_account","entry":[{"id":"123"}]}'
const goodSig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(BODY, 'utf-8').digest('hex')

test('verifyMetaSignature: accepts a genuine signature over the raw body', () => {
  assert.equal(verifyMetaSignature(SECRET, goodSig, BODY), true)
})

test('verifyMetaSignature: rejects a tampered body (the forgery case)', () => {
  const tampered = BODY.replace('123', '999')
  assert.equal(verifyMetaSignature(SECRET, goodSig, tampered), false)
})

test('verifyMetaSignature: rejects the wrong secret', () => {
  assert.equal(verifyMetaSignature('wrong_secret', goodSig, BODY), false)
})

test('verifyMetaSignature: rejects a forged signature', () => {
  assert.equal(verifyMetaSignature(SECRET, 'sha256=deadbeef', BODY), false)
})

test('verifyMetaSignature: rejects missing signature or secret, never throws', () => {
  assert.equal(verifyMetaSignature(SECRET, null, BODY), false)
  assert.equal(verifyMetaSignature(SECRET, '', BODY), false)
  assert.equal(verifyMetaSignature('', goodSig, BODY), false)
})

test('verifyMetaSignature: mismatched length does not throw (timingSafeEqual guard)', () => {
  assert.equal(verifyMetaSignature(SECRET, 'sha256=short', BODY), false)
})

// ── parseInbound ─────────────────────────────────────────────────────────────
function inboundPayload(overrides = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_ID',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '96181056376', phone_number_id: 'PNID' },
          contacts: [{ profile: { name: 'Joe Khoury' }, wa_id: '9613870377' }],
          messages: [{
            from: '9613870377',
            id: 'wamid.ABC123',
            timestamp: '1700000000',
            type: 'text',
            text: { body: 'show me villas in Jounieh' },
          }],
          ...overrides,
        },
      }],
    }],
  }
}

test('parseInbound: extracts a text message', () => {
  const m = parseInbound(inboundPayload())
  assert.deepEqual(m, {
    from: '9613870377',
    text: 'show me villas in Jounieh',
    name: 'Joe Khoury',
    messageId: 'wamid.ABC123',
    type: 'text',
  })
})

test('parseInbound: returns null for a status callback (delivery/read receipt)', () => {
  const statusPayload = {
    entry: [{ changes: [{ value: { messaging_product: 'whatsapp', statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
  }
  assert.equal(parseInbound(statusPayload), null)
})

test('parseInbound: reads the title of a tapped interactive button', () => {
  const payload = inboundPayload({
    messages: [{
      from: '9613870377', id: 'wamid.BTN', type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Confirm' } },
    }],
  })
  const m = parseInbound(payload)
  assert.equal(m.text, 'Confirm')
  assert.equal(m.type, 'interactive')
})

test('parseInbound: reads a template quick-reply button', () => {
  const payload = inboundPayload({
    messages: [{ from: '9613870377', id: 'wamid.QR', type: 'button', button: { text: 'done', payload: 'DONE' } }],
  })
  assert.equal(parseInbound(payload).text, 'done')
})

test('parseInbound: reads a submitted WhatsApp Flow form (nfm_reply)', () => {
  const payload = inboundPayload({
    messages: [{
      from: '9613870377', id: 'wamid.FLOW', type: 'interactive',
      interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ __flow: 'create_client', name: 'Joe', phone: '03123456', clientType: 'Buyer' }) } },
    }],
  })
  const m = parseInbound(payload)
  assert.equal(m.type, 'flow')
  assert.deepEqual(m.flow.data, { __flow: 'create_client', name: 'Joe', phone: '03123456', clientType: 'Buyer' })
})

test('parseInbound: non-text media message yields empty text but still parses', () => {
  const payload = inboundPayload({
    messages: [{ from: '9613870377', id: 'wamid.IMG', type: 'image', image: { id: 'media123' } }],
  })
  const m = parseInbound(payload)
  assert.equal(m.text, '')
  assert.equal(m.type, 'image')
  assert.equal(m.messageId, 'wamid.IMG')
})

test('parseInbound: garbage input returns null, never throws', () => {
  assert.equal(parseInbound(null), null)
  assert.equal(parseInbound({}), null)
  assert.equal(parseInbound({ entry: [] }), null)
  assert.equal(parseInbound('not json'), null)
})

// ── toCloudAddress ───────────────────────────────────────────────────────────
test('toCloudAddress: strips the leading + to bare digits', () => {
  assert.equal(toCloudAddress('+96181056376'), '96181056376')
})

test('toCloudAddress: strips a whatsapp: prefix and punctuation', () => {
  assert.equal(toCloudAddress('whatsapp:+961 3 870 377'), '9613870377')
})

test('toCloudAddress: already-bare digits pass through', () => {
  assert.equal(toCloudAddress('9613870377'), '9613870377')
})

test('toCloudAddress: null/empty yields empty string', () => {
  assert.equal(toCloudAddress(null), '')
  assert.equal(toCloudAddress(''), '')
})

test('parseInbound: reads an image message (media id + caption)', () => {
  const m = parseInbound({ entry: [{ changes: [{ value: { messages: [{ from: '961700', id: 'wamid.9', type: 'image', image: { id: 'MID123', mime_type: 'image/jpeg', caption: 'front' } }] } }] }] })
  assert.equal(m.type, 'image')
  assert.equal(m.text, 'front')
  assert.deepEqual(m.image, { id: 'MID123', mime: 'image/jpeg', caption: 'front' })
})
