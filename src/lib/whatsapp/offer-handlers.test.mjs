// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/offer-handlers.test.mjs
//
// Logging and settling an offer from WhatsApp. This is the flow that moves
// money: an accepted offer closes the deal as WON at that amount, which is what
// the agency's commission report is then built from. It had no tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './fake-db.mjs'
import { stageLogOffer, stageResolveOffer, handleQueryOffers } from './offer-handlers.ts'
import { applyPendingAction } from './write-handlers.ts'

const AGENT = { id: 'u1', company_id: 1, role: 'agent', agent_code: 'NH-1', Full_name: 'Nour Haddad' }
const OTHER = { id: 'u2', company_id: 1, role: 'agent', agent_code: 'SM-2', Full_name: 'Sara Mansour' }
const BOSS  = { id: 'u3', company_id: 1, role: 'manager', agent_code: 'MG-9', Full_name: 'The Manager' }

const seed = (o = {}) => fakeDb({
  client_requests: [
    { id: 10, company_id: 1, 'Client Name': 'Ahmed Khoury', 'client phone': '03 111 222',
      'prefered-location': 'Achrafieh', notes: JSON.stringify({ agentId: 'NH-1' }) },
  ],
  Properties: [
    { id: 23, company_id: 1, Title: 'Sea view apartment', Price: 500000, Status: 'Available',
      Amenities: JSON.stringify({ agentId: 'NH-1', type: 'Apartment' }) },
  ],
  deals: [{ id: 500, company_id: 1, client_id: 10, agent_id: 'NH-1', stage: o.stage ?? 'viewing', value: 0, property_id: o.propertyId ?? null }],
  offers: o.offers ?? [],
  pending_actions: [],
})

const pendingOf = db => db.table('pending_actions').at(-1)
const confirm = (db, profile) => {
  const p = pendingOf(db)
  assert.ok(p, 'nothing was staged for the agent to confirm')
  return applyPendingAction(db.client, profile, p.action_type, p.payload)
}

// ── Logging an offer ────────────────────────────────────────────────────────

test('log an offer: asked, confirmed, written — and the deal moves to negotiating', async () => {
  const db = seed()
  const reply = await stageLogOffer(db.client, AGENT, {
    intent: 'log_offer', clientName: 'Ahmed', propertyId: 23, fields: { amount: 450000 },
  })
  assert.match(reply, /450,000/)
  assert.match(reply, /Sea view apartment/)
  assert.equal(db.table('offers').length, 0, 'the offer was written before anyone confirmed')

  await confirm(db, AGENT)
  const offer = db.table('offers')[0]
  assert.equal(offer.amount, 450000)
  assert.equal(offer.side, 'buyer')
  assert.equal(offer.status, 'pending')
  assert.equal(offer.deal_id, 500)
  assert.equal(offer.created_by, 'NH-1')
  // A first offer pulls the deal into negotiating, and pins it to the listing.
  assert.equal(db.table('deals')[0].stage, 'negotiating')
  assert.equal(db.table('deals')[0].property_id, 23)
})

test('an owner counter is recorded as the owner\'s side', async () => {
  const db = seed({ propertyId: 23 })
  await stageLogOffer(db.client, AGENT, {
    intent: 'log_offer', clientName: 'Ahmed', propertyId: 23, fields: { amount: 480000, side: 'owner' },
  })
  await confirm(db, AGENT)
  assert.equal(db.table('offers')[0].side, 'owner')
})

test('an offer with no amount asks for one', async () => {
  const db = seed()
  assert.match(
    await stageLogOffer(db.client, AGENT, { intent: 'log_offer', clientName: 'Ahmed', propertyId: 23, fields: {} }),
    /How much/i)
  assert.equal(db.table('pending_actions').length, 0)
})

test('an offer with no client named asks who made it, and repeats the amount', async () => {
  const db = seed()
  const reply = await stageLogOffer(db.client, AGENT, { intent: 'log_offer', fields: { amount: 450000 } })
  assert.match(reply, /Who made it/i)
  assert.match(reply, /450k/, 'the agent is not shown the amount we understood')
})

test('an agent cannot log an offer on another agent\'s deal', async () => {
  const db = seed()
  const reply = await stageLogOffer(db.client, OTHER, {
    intent: 'log_offer', clientName: 'Ahmed', propertyId: 23, fields: { amount: 450000 },
  })
  assert.equal(db.table('pending_actions').length, 0)
  assert.match(reply, /another agent/i)
})

// ── Settling one ────────────────────────────────────────────────────────────

const withOpenOffer = () => seed({
  stage: 'negotiating', propertyId: 23,
  offers: [{ id: 'o1', company_id: 1, deal_id: 500, amount: 450000, side: 'buyer', status: 'pending', created_at: '2026-09-01' }],
})

test('accepting an offer closes the deal as won, at that amount', async () => {
  const db = withOpenOffer()
  const reply = await stageResolveOffer(db.client, AGENT, { intent: 'accept_offer', clientName: 'Ahmed' }, 'accept')
  assert.match(reply, /WON/i)
  assert.equal(db.table('deals')[0].stage, 'negotiating', 'the deal closed before anyone confirmed')

  await confirm(db, AGENT)
  assert.equal(db.table('offers')[0].status, 'accepted')
  const deal = db.table('deals')[0]
  assert.equal(deal.stage, 'closed')
  assert.equal(deal.outcome, 'won')
  assert.equal(deal.value, 450000, 'the closed value is what the commission report reads')
})

test('rejecting an offer settles it and leaves the deal open', async () => {
  const db = withOpenOffer()
  await stageResolveOffer(db.client, AGENT, { intent: 'reject_offer', clientName: 'Ahmed' }, 'reject')
  await confirm(db, AGENT)
  assert.equal(db.table('offers')[0].status, 'rejected')
  const deal = db.table('deals')[0]
  assert.equal(deal.stage, 'negotiating', 'a rejected offer should not close the deal')
  assert.notEqual(deal.outcome, 'won')
})

test('there is nothing to accept when no offer is open', async () => {
  const db = seed({ stage: 'negotiating', propertyId: 23 })
  await stageResolveOffer(db.client, AGENT, { intent: 'accept_offer', clientName: 'Ahmed' }, 'accept')
  assert.match(await confirm(db, AGENT), /no open offer/i)
  assert.equal(db.table('deals')[0].stage, 'negotiating')
})

test('accepting by listing number works when only one negotiation is open', async () => {
  const db = withOpenOffer()
  const reply = await stageResolveOffer(db.client, AGENT, { intent: 'accept_offer', propertyId: 23 }, 'accept')
  assert.match(reply, /Accept/i)
  await confirm(db, AGENT)
  assert.equal(db.table('deals')[0].outcome, 'won')
})

test('no open offer on the listing is said plainly', async () => {
  const db = seed({ stage: 'viewing', propertyId: 23 })
  assert.match(
    await stageResolveOffer(db.client, AGENT, { intent: 'accept_offer', propertyId: 23 }, 'accept'),
    /No open offer on #23/i)
})

test('neither a client nor a listing is answered with how to say it', async () => {
  const db = seed()
  assert.match(await stageResolveOffer(db.client, AGENT, { intent: 'accept_offer' }, 'accept'), /Which offer/i)
})

test('a manager can settle anybody\'s offer', async () => {
  const db = withOpenOffer()
  await stageResolveOffer(db.client, BOSS, { intent: 'accept_offer', clientName: 'Ahmed' }, 'accept')
  await confirm(db, BOSS)
  assert.equal(db.table('deals')[0].outcome, 'won')
})

test('permission is checked again when the offer is written', async () => {
  const db = withOpenOffer()
  await stageResolveOffer(db.client, AGENT, { intent: 'accept_offer', clientName: 'Ahmed' }, 'accept')
  const refused = await applyPendingAction(db.client, OTHER, pendingOf(db).action_type, pendingOf(db).payload)
  assert.match(refused, /permission/i)
  assert.equal(db.table('deals')[0].stage, 'negotiating', 'the deal closed anyway')
})

// ── Reading them back ───────────────────────────────────────────────────────

test('an agent can ask where an offer stands', async () => {
  const db = withOpenOffer()
  const reply = await handleQueryOffers(db.client, AGENT, { intent: 'query_offers', clientName: 'Ahmed' })
  assert.match(reply, /Ahmed Khoury/)
  assert.match(reply, /450,000/)
})

test('a client with no offers yet is told so', async () => {
  const db = seed()
  assert.match(
    await handleQueryOffers(db.client, AGENT, { intent: 'query_offers', clientName: 'Ahmed' }),
    /no offers/i)
})
