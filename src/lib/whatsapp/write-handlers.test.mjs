// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/write-handlers.test.mjs
//
// Changing a client or a listing from WhatsApp, end to end: the agent's words,
// the confirmation they are shown, and the row written when they say yes.
//
// This is the path that edits an agency's real records from a chat message, and
// until fake-db.mjs existed none of it could be run outside production. The
// rules worth guarding are the same three every time: nothing is written before
// a yes, an agent only touches their own records, and permission is checked
// again at write time because staging and applying are separate requests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './fake-db.mjs'
import { quickIntent } from './quick-intent.ts'
import {
  stageClientUpdate, stagePropertyUpdate, stageCreateProperty, applyPendingAction, resolveClient,
} from './write-handlers.ts'

const AGENT = { id: 'u1', company_id: 1, role: 'agent', agent_code: 'NH-1', Full_name: 'Nour Haddad' }
const OTHER = { id: 'u2', company_id: 1, role: 'agent', agent_code: 'SM-2', Full_name: 'Sara Mansour' }
const BOSS  = { id: 'u3', company_id: 1, role: 'manager', agent_code: 'MG-9', Full_name: 'The Manager' }

const seed = () => fakeDb({
  client_requests: [
    { id: 10, company_id: 1, 'Client Name': 'Ahmed Khoury', 'client phone': '03 111 222',
      budget_max: 400000, 'prefered-location': 'Achrafieh', bedrooms: 3, status: 'Searching',
      notes: JSON.stringify({ agentId: 'NH-1', email: 'a@x.com', req: { type: 'Apartment' } }) },
    { id: 11, company_id: 1, 'Client Name': 'Sara Mansour Client', 'client phone': '03 999 888',
      notes: JSON.stringify({ agentId: 'SM-2' }) },
  ],
  Properties: [
    { id: 23, company_id: 1, Title: 'Sea view apartment', Price: 500000, Status: 'Available',
      Location: 'Achrafieh', Bedrooms: 3, size: 180,
      Amenities: JSON.stringify({ agentId: 'NH-1', type: 'Apartment', transaction: 'For Sale' }) },
    { id: 24, company_id: 1, Title: "Someone else's flat", Price: 300000, Status: 'Available',
      Amenities: JSON.stringify({ agentId: 'SM-2', type: 'Apartment' }) },
  ],
  pending_actions: [],
})

const pendingOf = db => db.table('pending_actions').at(-1)
const confirm = (db, profile) => {
  const p = pendingOf(db)
  assert.ok(p, 'nothing was staged for the agent to confirm')
  return applyPendingAction(db.client, profile, p.action_type, p.payload)
}
const extrasOf = (row, col) => JSON.parse(row[col] || '{}')

// ═══ Clients ═══════════════════════════════════════════════════════════════

test('set a client budget: asked, confirmed, written', async () => {
  const db = seed()
  const intent = quickIntent("set Ahmed's budget to 550k")
  assert.equal(intent.intent, 'update_client')

  const reply = await stageClientUpdate(db.client, AGENT, intent)
  assert.match(reply, /Ahmed Khoury/)
  assert.match(reply, /550,000/)
  assert.equal(db.table('client_requests')[0].budget_max, 400000, 'the budget changed before anyone confirmed')

  assert.match(await confirm(db, AGENT), /Saved/)
  assert.equal(db.table('client_requests')[0].budget_max, 550000)
})

test('a client status change goes through the same confirmation', async () => {
  const db = seed()
  const intent = quickIntent('mark Ahmed as closed')
  assert.equal(intent.intent, 'update_client')
  await stageClientUpdate(db.client, AGENT, intent)
  await confirm(db, AGENT)
  assert.equal(db.table('client_requests')[0].status, 'Closed')
})

test('an agent cannot change another agent\'s client', async () => {
  const db = seed()
  const reply = await stageClientUpdate(db.client, OTHER, quickIntent("set Ahmed's budget to 550k"))
  assert.match(reply, /belongs to another agent/i)
  assert.equal(db.table('pending_actions').length, 0)
  assert.equal(db.table('client_requests')[0].budget_max, 400000)
})

test('a refusal does not leak the name it is refusing to show', async () => {
  // An agent who may not see a client's details must not learn them from the
  // sentence explaining why they cannot.
  const db = seed()
  const reply = await stageClientUpdate(db.client, OTHER, quickIntent("set Ahmed's budget to 550k"))
  assert.equal(reply.includes('Khoury'), false, 'the refusal leaked the full client name')
})

test('a manager can change anybody\'s client', async () => {
  const db = seed()
  await stageClientUpdate(db.client, BOSS, quickIntent("set Ahmed's budget to 550k"))
  await confirm(db, BOSS)
  assert.equal(db.table('client_requests')[0].budget_max, 550000)
})

test('the JSON blob is merged, never overwritten', async () => {
  // The whole reason updates re-read the row: the notes blob holds the owning
  // agent, the email and the brief, and none of them are resent with a change.
  const db = seed()
  await stageClientUpdate(db.client, AGENT, quickIntent("set Ahmed's budget to 550k"))
  await confirm(db, AGENT)
  const notes = extrasOf(db.table('client_requests')[0], 'notes')
  assert.equal(notes.agentId, 'NH-1')
  assert.equal(notes.email, 'a@x.com')
  assert.deepEqual(notes.req, { type: 'Apartment' })
})

test('nothing recognisable to change is answered, not staged', async () => {
  const db = seed()
  const reply = await stageClientUpdate(db.client, AGENT, { intent: 'update_client', clientName: 'Ahmed', fields: {} })
  assert.match(reply, /didn't catch what to change/i)
  assert.equal(db.table('pending_actions').length, 0)
})

test('an unknown client is answered, and two matches ask which', async () => {
  const db = seed()
  assert.match(
    await stageClientUpdate(db.client, AGENT, { intent: 'update_client', clientName: 'Georges', fields: { budget: 1 } }),
    /No client matching/i)

  // "Sara" matches both a client called Sara and one whose name contains it.
  const two = fakeDb({
    client_requests: [
      { id: 1, company_id: 1, 'Client Name': 'Sara Haddad', 'prefered-location': 'Achrafieh', notes: '{"agentId":"NH-1"}' },
      { id: 2, company_id: 1, 'Client Name': 'Sara Khoury', 'prefered-location': 'Jounieh', notes: '{"agentId":"NH-1"}' },
    ],
    pending_actions: [],
  })
  const found = await resolveClient(two.client, AGENT, 'Sara')
  assert.equal(found.ok, false)
  assert.match(found.message, /2 clients match/i)
  assert.match(found.message, /Achrafieh/)
})

// ═══ Listings ══════════════════════════════════════════════════════════════

test('mark a listing sold: asked, confirmed, written', async () => {
  const db = seed()
  const intent = quickIntent('mark property #23 as sold')
  assert.equal(intent.intent, 'update_property')
  assert.equal(intent.propertyId, 23)

  const reply = await stagePropertyUpdate(db.client, AGENT, intent)
  assert.match(reply, /#23/)
  assert.equal(db.table('Properties')[0].Status, 'Available', 'the listing changed before anyone confirmed')

  await confirm(db, AGENT)
  assert.equal(db.table('Properties')[0].Status, 'Sold')
})

test('a listing price change is written as a number', async () => {
  const db = seed()
  await stagePropertyUpdate(db.client, AGENT, quickIntent('set property #23 price to 520k'))
  await confirm(db, AGENT)
  assert.equal(db.table('Properties')[0].Price, 520000)
})

test('an agent cannot change another agent\'s listing', async () => {
  const db = seed()
  const reply = await stagePropertyUpdate(db.client, AGENT,
    { intent: 'update_property', propertyId: 24, fields: { status: 'Sold' } })
  assert.match(reply, /listed by another agent/i)
  assert.equal(db.table('pending_actions').length, 0)
})

test('a listing that does not exist is answered plainly', async () => {
  const db = seed()
  assert.match(
    await stagePropertyUpdate(db.client, AGENT, { intent: 'update_property', propertyId: 999, fields: { status: 'Sold' } }),
    /No listing with id #999/)
})

test('no listing number at all is answered with how to give one', async () => {
  const db = seed()
  assert.match(
    await stagePropertyUpdate(db.client, AGENT, { intent: 'update_property', fields: { status: 'Sold' } }),
    /Which listing/i)
})

test('the listing blob is merged, so the owner and type survive an edit', async () => {
  const db = seed()
  await stagePropertyUpdate(db.client, AGENT, quickIntent('set property #23 price to 520k'))
  await confirm(db, AGENT)
  const extras = extrasOf(db.table('Properties')[0], 'Amenities')
  assert.equal(extras.agentId, 'NH-1')
  assert.equal(extras.type, 'Apartment')
  assert.equal(extras.transaction, 'For Sale')
})

// ── Creating a listing from a chat ──────────────────────────────────────────

test('add a listing: enough detail, and it is created under the agent', async () => {
  const db = seed()
  const reply = await stageCreateProperty(db.client, AGENT, {
    intent: 'create_property',
    fields: { title: 'Bright flat', price: 450000, location: 'Hamra', type: 'Apartment', beds: 3, size: 180 },
  })
  assert.match(reply, /new listing/i)
  assert.equal(db.table('Properties').length, 2, 'a listing was created before anyone confirmed')

  await confirm(db, AGENT)
  const made = db.table('Properties').at(-1)
  assert.equal(made.Title, 'Bright flat')
  assert.equal(made.Price, 450000)
  assert.equal(made.company_id, 1)
  assert.equal(extrasOf(made, 'Amenities').agentId, 'NH-1', 'the listing is not filed under whoever added it')
})

test('too little to create a listing asks for the rest', async () => {
  const db = seed()
  const reply = await stageCreateProperty(db.client, AGENT, { intent: 'create_property', fields: { title: 'Flat' } })
  assert.match(reply, /missing/i)
  assert.equal(db.table('pending_actions').length, 0)
})

test('a manager creating a listing does not stamp it to a phantom agent', async () => {
  // Managers have no agent_code. The key is left off rather than written as
  // null, which would read as "owned by nobody" instead of "not agent-owned".
  const db = seed()
  await stageCreateProperty(db.client, { ...BOSS, agent_code: null }, {
    intent: 'create_property',
    fields: { title: 'Manager flat', price: 300000, location: 'Hamra', type: 'Apartment', beds: 2, size: 100 },
  })
  await confirm(db, { ...BOSS, agent_code: null })
  assert.equal('agentId' in extrasOf(db.table('Properties').at(-1), 'Amenities'), false)
})

// ═══ The rules that apply to every write ═══════════════════════════════════

test('permission is checked again when the write happens', async () => {
  for (const [label, stageIt] of [
    ['client', db => stageClientUpdate(db.client, AGENT, quickIntent("set Ahmed's budget to 550k"))],
    ['listing', db => stagePropertyUpdate(db.client, AGENT, quickIntent('mark property #23 as sold'))],
  ]) {
    const db = seed()
    await stageIt(db)
    const refused = await applyPendingAction(db.client, OTHER, pendingOf(db).action_type, pendingOf(db).payload)
    assert.match(refused, /no longer have permission/i, label)
  }
  const db = seed()
  await stageClientUpdate(db.client, AGENT, quickIntent("set Ahmed's budget to 550k"))
  await applyPendingAction(db.client, OTHER, pendingOf(db).action_type, pendingOf(db).payload)
  assert.equal(db.table('client_requests')[0].budget_max, 400000, 'the write went through anyway')
})

test('one live action per agent: a new request replaces the last', async () => {
  // A stale half-finished edit must never be the thing a later "yes" applies.
  const db = seed()
  await stageClientUpdate(db.client, AGENT, quickIntent("set Ahmed's budget to 550k"))
  await stagePropertyUpdate(db.client, AGENT, quickIntent('mark property #23 as sold'))
  assert.equal(db.table('pending_actions').length, 1)
  assert.equal(pendingOf(db).action_type, 'update_property')
})

test('a payload that expired or arrived empty is answered, not thrown at', async () => {
  const db = seed()
  assert.match(await applyPendingAction(db.client, AGENT, 'update_client', null), /expired/i)
  assert.match(await applyPendingAction(db.client, AGENT, 'update_client', {}), /expired/i)
})

test('a record deleted between the question and the yes is handled', async () => {
  const db = seed()
  await stageClientUpdate(db.client, AGENT, quickIntent("set Ahmed's budget to 550k"))
  const gone = fakeDb({ client_requests: [], Properties: [], pending_actions: db.table('pending_actions') })
  assert.match(await applyPendingAction(gone.client, AGENT, pendingOf(db).action_type, pendingOf(db).payload),
    /no longer exists/i)
})
