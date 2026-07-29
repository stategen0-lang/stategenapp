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
test('client lookup: "who is", "pull up", "look up" all work', () => {
  for (const s of ['who is Ahmed', "who's Ahmed", 'pull up Ahmed', 'look up Ahmed', 'bring up Ahmed', 'find me Ahmed']) {
    const r = quickIntent(s)
    assert.equal(r?.intent, 'query_client', s)
    assert.equal(r?.clientName, 'Ahmed', s)
  }
})
test('client lookup keeps an area qualifier on the name', () => {
  // Disambiguation is handled downstream; the quick matcher just passes it through.
  assert.equal(quickIntent('info on Nour in Beit Mery')?.clientName, 'Nour in Beit Mery')
})
test('"who is available" is a property query, not a client', () => {
  assert.notEqual(quickIntent('who is available')?.intent, 'query_client')
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

// ── share a listing link ─────────────────────────────────────────────────────
test('share a listing link: phrasing variants all carry the id', () => {
  for (const s of [
    'send me the link for #23', 'share property 23', 'link to listing 23',
    'link for #23', 'whats the link for property 23', 'share 23', 'link 23',
    'send me the link 23',
  ]) {
    const r = quickIntent(s)
    assert.equal(r?.intent, 'share_listing', s)
    assert.equal(r?.propertyId, 23, s)
  }
})
test('a "link" request with no id still routes to share (handler asks which)', () => {
  // "send me the link" clearly wants a listing link — route it to share_listing
  // with no id so the handler prompts for the number, rather than generic help.
  const r = quickIntent('send me the link')
  assert.equal(r?.intent, 'share_listing')
  assert.equal(r?.propertyId, undefined)
})
test('a share request without the word "link" or an id is not read as share', () => {
  // "share how the team is doing" has no id and no "link" → falls through to the
  // team report, not share_listing.
  assert.notEqual(quickIntent('share how the team is doing')?.intent, 'share_listing')
})
test('a property search mentioning a budget is not read as a share', () => {
  // "500k" must not be mistaken for a listing id.
  const r = quickIntent('share listings around 500k')
  assert.notEqual(r?.intent, 'share_listing')
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
// ── pipeline: move a deal ─────────────────────────────────────────────────────
test('move <name> to <stage>', () => {
  const r = quickIntent('move Ahmed to negotiating')
  assert.equal(r.intent, 'update_deal')
  assert.equal(r.clientName, 'Ahmed')
  assert.deepEqual(r.fields, { stage: 'negotiating' })
})
test('deal move: verbs and synonyms', () => {
  assert.equal(quickIntent('advance Sara to viewing')?.fields.stage, 'viewing')
  assert.equal(quickIntent('push Ahmed to the negotiation stage')?.fields.stage, 'negotiating')
  assert.equal(quickIntent('move Ahmed to contacted')?.fields.stage, 'contacted')
})
test('mark <name> as won/lost closes the deal with an outcome', () => {
  assert.deepEqual(quickIntent("mark Ahmed's deal as won")?.fields, { stage: 'closed', outcome: 'won' })
  assert.deepEqual(quickIntent('close Sara as lost')?.fields, { stage: 'closed', outcome: 'lost' })
  assert.equal(quickIntent('mark Ahmed as won')?.intent, 'update_deal')
})
test('"mark <name> as closed" stays a client status change, not a deal move', () => {
  // "closed" alone is a client status word; deal closing uses won/lost.
  assert.equal(quickIntent('mark Ahmed as closed')?.intent, 'update_client')
})
test('"mark property #23 as sold" stays a property update, not a deal', () => {
  assert.equal(quickIntent('mark property #23 as sold')?.intent, 'update_property')
})

// ── pipeline: read the board ──────────────────────────────────────────────────
test('pipeline reads', () => {
  assert.equal(quickIntent('show my pipeline')?.intent, 'query_pipeline')
  assert.equal(quickIntent('my pipeline')?.intent, 'query_pipeline')
  assert.equal(quickIntent('show my deals')?.intent, 'query_pipeline')
})
test('pipeline read carries a named stage', () => {
  const r = quickIntent("what's in negotiation")
  assert.equal(r?.intent, 'query_pipeline')
  assert.deepEqual(r?.fields, { stage: 'negotiating' })
  assert.deepEqual(quickIntent('anything in viewing?')?.fields, { stage: 'viewing' })
})
test('a bare pipeline ask has no stage filter', () => {
  assert.equal(quickIntent('show my pipeline')?.fields, undefined)
})

test('mark <name> as closed', () => {
  const r = quickIntent('mark Ahmed as closed')
  assert.equal(r.intent, 'update_client')
  assert.equal(r.clientName, 'Ahmed')
  assert.deepEqual(r.fields, { status: 'Closed' })
})

// ── calendar ────────────────────────────────────────────────────────────────
test('booking an event', () => {
  for (const s of [
    'book a viewing with Ahmed tomorrow at 3pm',
    'add a meeting friday 10am',
    'schedule a call with Nour on monday',
    'set up an appointment tomorrow',
  ]) assert.equal(quickIntent(s)?.intent, 'create_event', s)
})
test('adding a listing is not read as a calendar event', () => {
  // Both start with "add"; only one is a calendar entry.
  for (const s of ['add a listing', 'add listing: 3 bed in Hamra 450k', 'create a property']) {
    assert.notEqual(quickIntent(s)?.intent, 'create_event', s)
  }
})
test('asking for the schedule', () => {
  for (const s of ["what's on today", 'my schedule tomorrow', 'calendar for friday', 'anything booked today?']) {
    assert.equal(quickIntent(s)?.intent, 'query_schedule', s)
  }
})
test('a property search is not read as a schedule query', () => {
  assert.notEqual(quickIntent('what properties match 500k in Beirut')?.intent, 'query_schedule')
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
