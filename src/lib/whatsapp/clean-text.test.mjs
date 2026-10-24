// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/clean-text.test.mjs
//
// Two bugs from one real conversation, in which an agent spent thirty minutes
// trying to add a single client, pasted her details eleven times, typed
// "Cancel" nine times, and gave up. The names and number below are invented;
// the invisible characters are exactly the ones in the logged message.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanInboundText } from './clean-text.ts'
import { parseForm, CREATE_CLIENT_STEPS, startKind } from './flows.ts'

const LRE = '‪'   // left-to-right embedding — WhatsApp wraps copied numbers in these
const PDF = '‬'   // pop directional formatting
const NBSP = ' '  // no-break space

// The shape of the logged message: the phone line starts with an invisible
// marker, so "phone:" is not at the start of the line and the form parser does
// not see the label at all.
const BRIEF = [
  'Name: Rita Haddad ',
  `${LRE}phone: 70123${NBSP}456${PDF}`,
  'Request: small studio or Apartment for rent ',
  'Furnished ',
  'Location: Kaslik-Jounieh',
  'Budget: max 600$',
].join('\n')

// ── Bug 1: the phone number nobody could see ────────────────────────────────

test('the phone in a copied brief is found once the text is cleaned', () => {
  // Reproduces the failure: without cleaning, the label is invisible to the
  // parser, so the bot asked "What's their phone number?" after being given it.
  assert.equal(parseForm(BRIEF, CREATE_CLIENT_STEPS).context.phone, undefined)
  // The fix.
  assert.equal(parseForm(cleanInboundText(BRIEF), CREATE_CLIENT_STEPS).context.phone, '70123 456')
})

test('every bidi and zero-width formatting character is removed', () => {
  const marks = ['‎', '‏', '‪', '‫', '‬', '‭', '‮',
                 '⁦', '⁧', '⁨', '⁩', '؜', '​', '⁠', '﻿']
  for (const m of marks) {
    assert.equal(cleanInboundText(`70${m}123${m}456`), '70123456', `U+${m.codePointAt(0).toString(16).toUpperCase()}`)
  }
})

test('every lookalike space becomes an ordinary one', () => {
  for (const sp of [' ', ' ', ' ', ' ', ' ', ' ', '　']) {
    assert.equal(cleanInboundText(`03${sp}123${sp}456`), '03 123 456', `U+${sp.codePointAt(0).toString(16).toUpperCase()}`)
  }
})

test('the layout is left alone', () => {
  // Briefs are one field per line, and the form parser depends on it. Blank
  // lines and indentation belong to the agent.
  const text = 'Name: Joe\n\n  Phone: 03 123 456\nArea: Hamra'
  assert.equal(cleanInboundText(text), text)
  assert.equal(cleanInboundText('a\r\nb\rc'), 'a\nb\nc')
})

test('meaningful characters survive', () => {
  // m² must not become m2 — that is why the normalisation is NFC, not NFKC.
  assert.equal(cleanInboundText('120 m² flat'), '120 m² flat')
  // Arabic text, and the joiners that hold emoji sequences together.
  assert.equal(cleanInboundText('شقة للبيع'), 'شقة للبيع')
  assert.equal(cleanInboundText('family 👨‍👩‍👧'), 'family 👨‍👩‍👧')
})

test('cleaning is safe to repeat, and tolerates nothing', () => {
  const once = cleanInboundText(BRIEF)
  assert.equal(cleanInboundText(once), once)
  assert.equal(cleanInboundText(''), '')
  assert.equal(cleanInboundText(null), '')
  assert.equal(cleanInboundText(undefined), '')
})

// ── Bug 2: a client brief sent to the listing form ──────────────────────────

test('"Add client …" is a client even when the brief mentions an apartment', () => {
  // The live failure: the brief names the property the client wants, both
  // detectors matched, and the listing one was checked first — so the agent
  // was asked "What type of property is it?", six times.
  assert.equal(startKind('Add client Rita Haddad phone: 70123 456 Request: small studio or Apartment for rent'), 'client')
  assert.equal(startKind('add new client, wants a villa in Broummana'), 'client')
  assert.equal(startKind('Add a buyer looking for an apartment in Hamra'), 'client')
})

test('a listing that mentions a client is still a listing', () => {
  // The first noun after the verb is the thing being added.
  assert.equal(startKind('add an apartment for my client in Hamra'), 'listing')
  assert.equal(startKind('add listing 3 bed apartment Kaslik 300k'), 'listing')
})

test('only one kind named, or none', () => {
  assert.equal(startKind('add apartment Achrafieh 450k'), 'listing')
  assert.equal(startKind('add client Joe 03 123 456'), 'client')
  assert.equal(startKind('what matches 500k in Beirut'), null)
  assert.equal(startKind(''), null)
  assert.equal(startKind(null), null)
})
