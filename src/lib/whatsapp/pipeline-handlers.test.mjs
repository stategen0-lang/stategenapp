// node --experimental-strip-types --test src/lib/whatsapp/pipeline-handlers.test.mjs
//
// Moving a deal along the pipeline from WhatsApp, end to end: the agent's
// words, the confirmation they are shown, and the row that is written when they
// say yes. Run against a fake database (fake-db.mjs), because the value of this
// path is entirely in what it writes and to whose deal.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './fake-db.mjs'
import { quickIntent } from './quick-intent.ts'
import { stageDealMove, handleQueryPipeline } from './pipeline-handlers.ts'
import { applyPendingAction } from './write-handlers.ts'

const AGENT = { id: 'u1', company_id: 1, role: 'agent', agent_code: 'NH-1', Full_name: 'Nour Haddad' }
const OTHER = { id: 'u2', company_id: 1, role: 'agent', agent_code: 'SM-2', Full_name: 'Sara Mansour' }
const BOSS  = { id: 'u3', company_id: 1, role: 'manager', agent_code: 'MG-9', Full_name: 'The Manager' }

const seed = () => fakeDb({
  client_requests: [
    { id: 10, company_id: 1, 'Client Name': 'Ahmed Khoury', 'client phone': '03 111 222',
      notes: JSON.stringify({ agentId: 'NH-1' }), 'prefered-location': 'Achrafieh' },
  ],
  deals: [{ id: 500, company_id: 1, client_id: 10, agent_id: 'NH-1', stage: 'lead', value: 450000 }],
  pending_actions: [],
})

/** What the bot does with one sentence: classify it, then stage the change. */
async function say(db, profile, text) {
  const intent = quickIntent(text)
  assert.ok(intent, `"${text}" was not understood at all`)
  assert.equal(intent.intent, 'update_deal', `"${text}" was read as ${intent.intent}`)
  return { intent, reply: await stageDealMove(db.client, profile, intent) }
}

/** The "yes" that follows. */
const confirm = (db, profile) => {
  const pending = db.table('pending_actions').at(-1)
  assert.ok(pending, 'nothing was staged for the agent to confirm')
  return applyPendingAction(db.client, profile, pending.action_type, pending.payload)
}

// ── The whole round trip ────────────────────────────────────────────────────

test('move a deal forward: asked, confirmed, written', async () => {
  const db = seed()
  const { reply } = await say(db, AGENT, 'move Ahmed to negotiating')

  // Nothing is written until the agent says yes — that is the rule for every
  // write the bot makes.
  assert.equal(db.writesTo('deals', 'update').length, 0, 'the deal moved before anyone confirmed')
  assert.match(reply, /Ahmed Khoury/)
  assert.match(reply, /Lead/)
  assert.match(reply, /Negotiating/)

  const done = await confirm(db, AGENT)
  assert.match(done, /Saved/)
  assert.equal(db.table('deals')[0].stage, 'negotiating')
  // The outcome is cleared on any stage that is not "closed", so a deal that
  // was once lost and is revived does not stay marked lost.
  assert.equal(db.table('deals')[0].outcome, null)
})

test('closing a deal records which way it went', async () => {
  const db = seed()
  await say(db, AGENT, 'mark Ahmed as won')
  await confirm(db, AGENT)
  assert.equal(db.table('deals')[0].stage, 'closed')
  assert.equal(db.table('deals')[0].outcome, 'won')

  const lost = seed()
  await say(lost, AGENT, 'mark Ahmed as lost')
  await confirm(lost, AGENT)
  assert.equal(lost.table('deals')[0].outcome, 'lost')
})

test('"closed" without won or lost is asked about, not guessed', async () => {
  const db = seed()
  const { reply } = await say(db, AGENT, 'advance Ahmed to closed')
  assert.match(reply, /won or lost/i)
  assert.equal(db.table('pending_actions').length, 0, 'an ambiguous close was staged anyway')
})

test('a deal already at that stage says so instead of staging a no-op', async () => {
  const db = fakeDb({
    client_requests: seed().table('client_requests'),
    deals: [{ id: 500, company_id: 1, client_id: 10, agent_id: 'NH-1', stage: 'negotiating', value: 450000 }],
    pending_actions: [],
  })
  const { reply } = await say(db, AGENT, 'move Ahmed to negotiating')
  assert.match(reply, /already at Negotiating/i)
  assert.equal(db.table('pending_actions').length, 0)
})

// ── Whose deal it is ────────────────────────────────────────────────────────

test('an agent cannot move another agent\'s deal', async () => {
  const db = seed()
  const { reply } = await say(db, OTHER, 'move Ahmed to negotiating')
  assert.match(reply, /another agent/i)
  assert.equal(db.table('pending_actions').length, 0)
  assert.equal(db.table('deals')[0].stage, 'lead')
})

test('a manager can move anybody\'s deal', async () => {
  const db = seed()
  await say(db, BOSS, 'move Ahmed to viewing')
  await confirm(db, BOSS)
  assert.equal(db.table('deals')[0].stage, 'viewing')
})

test('permission is checked again when the write happens, not only when staged', async () => {
  // The two are separate requests; a role can change in between, and the
  // pending row is just a note of what was asked for.
  const db = seed()
  await say(db, AGENT, 'move Ahmed to negotiating')
  const refused = await confirm(db, OTHER)
  assert.match(refused, /no longer have permission/i)
  assert.equal(db.table('deals')[0].stage, 'lead')
})

// ── A client with no deal ───────────────────────────────────────────────────

test('a client whose deal is missing is told, not crashed at', async () => {
  const db = fakeDb({
    client_requests: seed().table('client_requests'),
    deals: [],
    pending_actions: [],
  })
  const { reply } = await say(db, AGENT, 'move Ahmed to negotiating')
  assert.match(reply, /no deal in the pipeline/i)
})

test('an unknown client name is answered, not guessed', async () => {
  const db = seed()
  const intent = quickIntent('move Georges to negotiating')
  const reply = await stageDealMove(db.client, AGENT, intent)
  assert.match(reply, /No client matching/i)
  assert.equal(db.table('pending_actions').length, 0)
})

// ── Reading the board ───────────────────────────────────────────────────────

test('an agent can read their pipeline from the bot', async () => {
  const db = seed()
  const reply = await handleQueryPipeline(db.client, AGENT, { intent: 'query_pipeline' })
  // The whole board is a summary — a count and a value per stage. Names belong
  // to the per-stage answer, not to a list an agent has to scroll on a phone.
  assert.match(reply, /Your pipeline/i)
  assert.match(reply, /Lead: 1 deal/)
  assert.match(reply, /1 deal · /, 'the total said "1 deals"')
})

test('an agent with nothing in the pipeline is told so plainly', async () => {
  const db = fakeDb({ client_requests: [], deals: [], pending_actions: [] })
  assert.match(await handleQueryPipeline(db.client, AGENT, { intent: 'query_pipeline' }), /no deals in the pipeline/i)
})

test('asking about one stage answers about that stage', async () => {
  const db = seed()
  const intent = quickIntent('whats in negotiation')
  assert.equal(intent.intent, 'query_pipeline')
  assert.equal(intent.fields.stage, 'negotiating')
  const reply = await handleQueryPipeline(db.client, AGENT, intent)
  assert.match(reply, /negotiating/i)
})

// ── The words agents actually type ──────────────────────────────────────────

test('the phrasings an agent reaches for all land on the same move', async () => {
  for (const text of [
    'move Ahmed to negotiating',
    'Move Ahmed to negotiation',
    'advance Ahmed to negotiating',
    'push Ahmed to negotiating',
    'put Ahmed in negotiating',
    'update Ahmed deal to negotiating',
    'move Ahmed Khoury to negotiating',
  ]) {
    const db = seed()
    await say(db, AGENT, text)
    await confirm(db, AGENT)
    assert.equal(db.table('deals')[0].stage, 'negotiating', text)
  }
})

test('a possessive typed without the apostrophe still finds the client', async () => {
  // "ahmeds deal is won" — which is how it arrives from a phone keyboard.
  const db = seed()
  await say(db, AGENT, 'ahmeds deal is won')
  await confirm(db, AGENT)
  assert.equal(db.table('deals')[0].stage, 'closed')
  assert.equal(db.table('deals')[0].outcome, 'won')
})

// ── Every stage is reachable by name ────────────────────────────────────────

test('all five stages can be reached from a sentence', async () => {
  for (const [text, stage] of [
    ['move Ahmed to lead', 'lead'],
    ['move Ahmed to contacted', 'contacted'],
    ['move Ahmed to viewing', 'viewing'],
    ['move Ahmed to negotiating', 'negotiating'],
    ['mark Ahmed as won', 'closed'],
  ]) {
    const db = fakeDb({
      client_requests: seed().table('client_requests'),
      // Start somewhere else so no move is a no-op.
      deals: [{ id: 500, company_id: 1, client_id: 10, agent_id: 'NH-1', stage: stage === 'lead' ? 'viewing' : 'lead', value: 1 }],
      pending_actions: [],
    })
    await say(db, AGENT, text)
    await confirm(db, AGENT)
    assert.equal(db.table('deals')[0].stage, stage, text)
  }
})
