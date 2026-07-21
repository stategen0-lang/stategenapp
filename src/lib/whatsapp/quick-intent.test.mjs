// Unit tests for deterministic intent matching (src/lib/whatsapp/quick-intent.ts).
//
// This path decides what most real messages mean without consulting the model,
// so a wrong match here is worse than no match: returning null just costs a few
// seconds, but a wrong intent gives the agent the wrong answer.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quickIntent } from './quick-intent.ts'

// ── help ────────────────────────────────────────────────────────────────────
test('help', () => {
  for (const s of ['help', 'Help', 'menu', 'what can you do?', '?']) {
    assert.equal(quickIntent(s)?.intent, 'help', s)
  }
})

// ── client lookup ───────────────────────────────────────────────────────────
test('info on <name>', () => {
  const r = quickIntent('info on Ahmed')
  assert.equal(r.intent, 'query_client')
  assert.equal(r.clientName, 'Ahmed')
})
test('info on <name>: phrasing variants', () => {
  for (const s of ['send me info on Ahmed', 'details about Ahmed', 'information for client Ahmed', 'info on Ahmed?']) {
    const r = quickIntent(s)
    assert.equal(r?.intent, 'query_client', s)
    assert.equal(r?.clientName, 'Ahmed', s)
  }
})
test('info on a full name keeps the whole name', () => {
  assert.equal(quickIntent('info on Sara Rizk')?.clientName, 'Sara Rizk')
})
test('"info on properties in Beirut" is a listing query, not a client', () => {
  assert.equal(quickIntent('info on properties in Beirut')?.intent, 'query_property')
})

// ── property queries ────────────────────────────────────────────────────────
test('what matches <budget> in <area>', () => {
  const r = quickIntent('what properties match 500k in Beirut')
  assert.equal(r.intent, 'query_property')
  assert.equal(r.budget, 500_000)
  assert.equal(r.location, 'Beirut')
})
test('budget shorthand and separators', () => {
  assert.equal(quickIntent('listings matching 1.2m in Hamra').budget, 1_200_000)
  assert.equal(quickIntent('properties around $450,000 in Verdun').budget, 450_000)
})
test('location without a budget still routes', () => {
  const r = quickIntent('any apartments in Achrafieh?')
  assert.equal(r.intent, 'query_property')
  assert.equal(r.location, 'Achrafieh')
})
test('property by number', () => {
  assert.deepEqual(quickIntent('property #23'), { intent: 'query_property', propertyId: 23 })
  assert.equal(quickIntent('info on property 23')?.propertyId, 23)
})

// ── updates ─────────────────────────────────────────────────────────────────
test('mark property #N as sold', () => {
  const r = quickIntent('mark property #23 as sold')
  assert.equal(r.intent, 'update_property')
  assert.equal(r.propertyId, 23)
  assert.deepEqual(r.fields, { status: 'Sold' })
})
test('property status words are canonicalised', () => {
  assert.deepEqual(quickIntent('mark property #4 as RENTED').fields, { status: 'Rented' })
  assert.deepEqual(quickIntent('property #4 is now available').fields, { status: 'Available' })
})
test("set <name>'s budget to <amount>", () => {
  const r = quickIntent("set Ahmed's budget to 400k")
  assert.equal(r.intent, 'update_client')
  assert.equal(r.clientName, 'Ahmed')
  assert.deepEqual(r.fields, { budget: 400_000 })
})
test('budget update: phrasing variants', () => {
  for (const s of ["update Ahmed's budget to 400k", 'change Ahmed budget to 400000', "set Sara Rizk's budget to $400,000"]) {
    const r = quickIntent(s)
    assert.equal(r?.intent, 'update_client', s)
    assert.equal(r?.fields.budget, 400_000, s)
  }
})
test('budget update with an unparseable amount is left to the model', () => {
  assert.equal(quickIntent("set Ahmed's budget to whatever he wants"), null)
})
test('mark <name> as closed', () => {
  const r = quickIntent('mark Ahmed as closed')
  assert.equal(r.intent, 'update_client')
  assert.equal(r.clientName, 'Ahmed')
  assert.deepEqual(r.fields, { status: 'Closed' })
})

// ── manager reports ─────────────────────────────────────────────────────────
test('team activity', () => {
  for (const s of ['how is the team doing?', 'agent activity', 'how are the agents performing']) {
    assert.equal(quickIntent(s)?.intent, 'query_agents', s)
  }
})
test('overdue follow-ups', () => {
  for (const s of ['what follow-ups are overdue?', 'overdue reminders', 'which follow ups are late']) {
    assert.equal(quickIntent(s)?.intent, 'query_overdue', s)
  }
})

// ── deferring to the model ──────────────────────────────────────────────────
test('open-ended messages return null so Grok can handle them', () => {
  for (const s of [
    'spoke to Ahmed yesterday, he seemed keen but wants to think about it',
    'the owner of the Hamra flat called about the price',
    'can you remind me what we discussed',
    'thanks!',
  ]) assert.equal(quickIntent(s), null, s)
})
test('empty input returns null', () => {
  assert.equal(quickIntent(''), null)
  assert.equal(quickIntent(null), null)
  assert.equal(quickIntent('   '), null)
})
test('a create-listing message is not misread as a query', () => {
  // isStartListing handles these; quickIntent must not claim them as searches.
  for (const s of ['add a listing', 'add listing: 3 bed apartment in Hamra, 450k', 'create a property']) {
    const r = quickIntent(s)
    assert.notEqual(r?.intent, 'query_property', s)
  }
})
test('reminder replies are not claimed here', () => {
  // These are matched earlier by parseReminderReply against a live reminder.
  for (const s of ['done', 'snooze 3d', 'not interested', 'yes', 'no']) {
    assert.equal(quickIntent(s), null, s)
  }
})
