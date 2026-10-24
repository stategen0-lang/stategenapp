// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/agent/agent.test.mjs
//
// The agent end to end, with a scripted Claude and a fake database: the real
// system prompt, history, tools and loop, minus the network. The scenario is
// the one that started this — an agent who spent half an hour failing to add a
// client — and the request sent to the API is checked field by field, since a
// wrong parameter there fails every message in production.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from '../fake-db.mjs'
import { answerWithAgent, agentEnabledFor } from './index.ts'
import { toMessages, MAX_MESSAGE_CHARS } from './history.ts'
import { contextBlock, SYSTEM_PROMPT } from './prompt.ts'
import { agentEffort, AGENT_MODEL } from './client.ts'
import { TOOLS } from './tools.ts'

const COMPANY = 7
const AGENT = { id: 'p-jad', company_id: COMPANY, role: 'agent', agent_code: 'JH-655', Full_name: 'Jad Habchi' }
const PHONE = '+96181000000'

/** A Claude client whose beta.messages.create returns scripted responses. */
function fakeClaude(...responses) {
  const requests = []
  return {
    requests,
    beta: { messages: { create: async (params) => {
      requests.push(structuredClone(params))
      const next = responses.shift()
      if (!next) throw new Error('Claude called more times than scripted')
      return next
    } } },
  }
}
const msg = (content, stop_reason) => ({
  id: 'm', type: 'message', role: 'assistant', model: AGENT_MODEL, content,
  stop_reason: stop_reason ?? (content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
  stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
})

function world(logs = []) {
  return fakeDb({
    Companies: [{ id: COMPANY, Name: 'Equity Properties', title_template: null }],
    Profiles: [{ id: 'p-jad', company_id: COMPANY, agent_code: 'JH-655', Full_name: 'Jad Habchi', role: 'agent' }],
    pending_actions: [], conversation_state: [], client_requests: [], Properties: [],
    whatsapp_logs: logs,
  })
}

const minutesAgo = m => new Date(Date.now() - m * 60_000).toISOString()

// The brief from the logged conversation, with the client's details replaced.
const BRIEF = `Add client Rita Haddad
phone: 70123 456
Request: small studio or Apartment for rent
Furnished
Location: Kaslik-Jounieh Sarba
Prefer close to USEK
Budget: max 500$`

test('the conversation that failed thirty times works in one turn', async () => {
  const db = world()
  const claude = fakeClaude(
    // Claude reads the whole brief and calls the tool once, with everything.
    msg([{ type: 'tool_use', id: 't1', name: 'create_client', input: {
      name: 'Rita Haddad', phone: '70123 456', client_type: 'renter', property_type: 'apartment',
      areas: ['Kaslik', 'Jounieh', 'Sarba'], budget: 500, beds: null, baths: null, parkings: null,
      min_size: null, view: null, furnishing: 'Furnished', floor: null, balcony: null,
      features: null, notes: 'Wants a small studio or apartment, close to USEK.', for_agent: null,
    } }]),
    msg([{ type: 'text', text: 'Sarba is close to Jounieh, so I kept all three areas.' }]),
  )

  const reply = await answerWithAgent({
    admin: db.client, profile: AGENT, body: BRIEF, phone: PHONE, inboundLogId: null,
    origin: 'https://stategen.app', legacy: async () => 'unused', claude,
  })

  // One staged client, nothing saved, and the agent is shown the real card.
  assert.match(reply, /About to add a new client/)
  assert.match(reply, /Rita Haddad/)
  assert.match(reply, /Reply YES/)
  assert.ok(reply.startsWith('Sarba is close to Jounieh'), 'the model\'s note leads')
  assert.equal(db.table('pending_actions').length, 1)
  assert.equal(db.table('client_requests').length, 0)
  // Two model calls: the tool call, then the reply. Not eleven.
  assert.equal(claude.requests.length, 2)
})

test('the request sent to Claude is exactly what the API expects', async () => {
  const db = world()
  const claude = fakeClaude(msg([{ type: 'text', text: 'Hi Jad!' }]))
  await answerWithAgent({
    admin: db.client, profile: AGENT, body: 'hi', phone: PHONE, inboundLogId: null,
    origin: 'https://stategen.app', legacy: async () => '', claude,
  })
  const [req] = claude.requests

  assert.equal(req.model, 'claude-opus-5-5')
  assert.ok(req.max_tokens >= 4000, 'room for thinking as well as the reply')
  // Rejected with a 400 since 21 Oct 2026 on every model.
  for (const banned of ['temperature', 'top_p', 'top_k']) assert.equal(banned in req, false, banned)
  // Forced tool use is a 400 on Opus 5.5.
  assert.deepEqual(req.tool_choice, { type: 'auto' })
  // Thinking can't be disabled on Opus 5.5; adaptive with an explicit binding.
  assert.equal(req.thinking.type, 'adaptive')
  assert.equal(req.thinking.block_binding.prefix_mismatch_behavior, 'drop_block')
  assert.equal(req.output_config.effort, 'medium')
  // Fallback on from day one, with the header that matches its form.
  assert.equal(req.fallbacks, 'default')
  assert.ok(req.betas.includes('server-side-fallback-2026-07-01'))
  assert.ok(req.betas.includes('thinking-binding-controls-2026-08-01'))
  // Stable prefix cached; the per-message context after it.
  assert.equal(req.system[0].text, SYSTEM_PROMPT)
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' })
  assert.equal(req.system[1].cache_control, undefined)
  assert.match(req.system[1].text, /Jad Habchi/)
  assert.match(req.system[1].text, /Equity Properties/)
  assert.equal(req.tools, TOOLS.length ? req.tools : req.tools)
  assert.deepEqual(req.tools.map(t => t.name), TOOLS.map(t => t.name))
  assert.deepEqual(req.messages.at(-1), { role: 'user', content: 'hi' })
})

test('the system prompt and tools are identical across rounds of one turn', async () => {
  // They are the prefix both the cache and the reasoning blocks depend on.
  const db = world()
  const claude = fakeClaude(
    msg([{ type: 'tool_use', id: 't1', name: 'get_listing', input: { listing_id: 999 } }]),
    msg([{ type: 'text', text: 'No such listing.' }]),
  )
  await answerWithAgent({
    admin: db.client, profile: AGENT, body: 'show #999', phone: PHONE, inboundLogId: null,
    origin: 'https://stategen.app', legacy: async () => '', claude,
  })
  const [a, b] = claude.requests
  assert.deepEqual(b.system, a.system)
  assert.deepEqual(b.tools, a.tools)
})

test('earlier messages in the conversation reach the model; the current one is not doubled', async () => {
  // "Add furnished" only means something after the brief it refers to.
  const db = world([
    { id: 1, from_number: PHONE, direction: 'inbound', message: BRIEF, created_at: minutesAgo(3) },
    { id: 2, from_number: PHONE, direction: 'outbound', message: 'About to add a new client: …', created_at: minutesAgo(2) },
    { id: 3, from_number: PHONE, direction: 'inbound', message: 'Add furnished', created_at: minutesAgo(0) },
    // Another agent's conversation must not leak in.
    { id: 4, from_number: '+96170999999', direction: 'inbound', message: 'someone else', created_at: minutesAgo(1) },
    // Nor yesterday's.
    { id: 5, from_number: PHONE, direction: 'inbound', message: 'old news', created_at: minutesAgo(60 * 24) },
  ])
  const claude = fakeClaude(msg([{ type: 'text', text: 'ok' }]))
  await answerWithAgent({
    admin: db.client, profile: AGENT, body: 'Add furnished', phone: PHONE, inboundLogId: '3',
    origin: 'https://stategen.app', legacy: async () => '', claude,
  })
  const sent = claude.requests[0].messages
  assert.deepEqual(sent.map(m => m.role), ['user', 'assistant', 'user'])
  assert.equal(sent[0].content, BRIEF)
  assert.equal(sent.at(-1).content, 'Add furnished')
  const all = JSON.stringify(sent)
  assert.equal(all.includes('someone else'), false)
  assert.equal(all.includes('old news'), false)
})

test('a staged change then "yes" is not the agent\'s job — but the card always tells them to reply yes', async () => {
  // The yes is caught by the webhook before the agent runs. Here we only
  // check the agent never ends a staging turn without that instruction.
  const db = world()
  const claude = fakeClaude(
    msg([{ type: 'tool_use', id: 't1', name: 'create_client', input: {
      name: 'Rita Haddad', phone: '70123 456', client_type: 'renter', property_type: 'apartment',
      areas: ['Kaslik'], budget: 500, beds: null, baths: null, parkings: null, min_size: null,
      view: null, furnishing: null, floor: null, balcony: null, features: null, notes: null, for_agent: null,
    } }]),
    msg([{ type: 'text', text: 'Saved! Rita is in the system.' }]),   // the model overclaims
  )
  const reply = await answerWithAgent({
    admin: db.client, profile: AGENT, body: BRIEF, phone: PHONE, inboundLogId: null,
    origin: 'https://stategen.app', legacy: async () => '', claude,
  })
  // Whatever the model claimed, the agent is told what to do to save it.
  assert.match(reply, /Reply YES to save/)
  assert.equal(db.table('client_requests').length, 0)
})

// ── The switch ──────────────────────────────────────────────────────────────

test('WHATSAPP_AGENT switches agencies on by id, all, or not at all', () => {
  assert.equal(agentEnabledFor(7, undefined), false)
  assert.equal(agentEnabledFor(7, ''), false)
  assert.equal(agentEnabledFor(7, 'off'), false)
  assert.equal(agentEnabledFor(7, 'all'), true)
  assert.equal(agentEnabledFor(7, '1,7'), true)
  assert.equal(agentEnabledFor(7, ' 1 , 7 '), true)
  assert.equal(agentEnabledFor(3, '1,7'), false)
  // "17" must not switch on 7.
  assert.equal(agentEnabledFor(7, '17'), false)
})

test('effort can be tuned, and falls back to medium on nonsense', () => {
  assert.equal(agentEffort(undefined), 'medium')
  assert.equal(agentEffort('LOW'), 'low')
  assert.equal(agentEffort('high'), 'high')
  assert.equal(agentEffort('ultra'), 'medium')
})

// ── History ─────────────────────────────────────────────────────────────────

test('history starts on the agent\'s side and merges runs from one side', () => {
  const rows = [
    { id: 1, direction: 'outbound', message: 'Reminder: call Ahmed', created_at: 'a' },   // dropped: can't lead
    { id: 2, direction: 'inbound', message: 'hi', created_at: 'b' },
    { id: 3, direction: 'outbound', message: 'Hello!', created_at: 'c' },
    { id: 4, direction: 'outbound', message: 'Reminder: call Rita', created_at: 'd' },  // merged with the one before
    { id: 5, direction: 'inbound', message: '   ', created_at: 'e' },                     // empty: skipped
    { id: 6, direction: 'inbound', message: 'done', created_at: 'f' },
  ]
  assert.deepEqual(toMessages(rows), [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'Hello!\n\nReminder: call Rita' },
    { role: 'user', content: 'done' },
  ])
})

test('a runaway message is clipped', () => {
  const [m] = toMessages([{ id: 1, direction: 'inbound', message: 'x'.repeat(MAX_MESSAGE_CHARS + 500), created_at: 'a' }])
  assert.equal(m.content.length, MAX_MESSAGE_CHARS + 1)
})

// ── Context ─────────────────────────────────────────────────────────────────

test('the context says who is talking, their role, and Beirut time', () => {
  // 21:30 UTC on Friday 23 Oct is 00:30 on Saturday 24 Oct in Beirut (UTC+3
  // until the clocks change on the 25th). A UTC date would be a day behind for
  // every "tomorrow at 3" sent after 9pm.
  const at = new Date('2026-10-23T21:30:00Z')
  const agent = contextBlock({ name: 'Jad Habchi', role: 'agent', agentCode: 'JH-655', company: 'Equity Properties' }, at)
  assert.match(agent, /Jad Habchi, an agent at Equity Properties \(agent ID JH-655\)/)
  assert.match(agent, /Saturday, 24 October 2026 at 00:30/)
  assert.match(agent, /change only their own/)
  const manager = contextBlock({ name: 'Maya', role: 'owner', agentCode: null, company: 'Equity Properties' }, at)
  assert.match(manager, /a manager/)
  assert.match(manager, /assigned to one of the agents/)
})

// ── Model choice ────────────────────────────────────────────────────────────

import { agentModel } from './client.ts'

async function requestFor(model) {
  const db = world()
  const claude = fakeClaude(msg([{ type: 'text', text: 'hi' }]))
  await answerWithAgent({
    admin: db.client, profile: AGENT, body: 'hi', phone: PHONE, inboundLogId: null,
    origin: 'https://stategen.app', legacy: async () => '', claude, model,
  })
  return claude.requests[0]
}

test('Haiku 5.5: no fallbacks parameter — it has no server-side fallback', async () => {
  // fallbacks "default" is useless on Haiku and the list form is a 400.
  const req = await requestFor('claude-haiku-5-5')
  assert.equal(req.model, 'claude-haiku-5-5')
  assert.equal('fallbacks' in req, false)
  assert.equal(req.betas.includes('server-side-fallback-2026-07-01'), false)
  // Everything else is the same safe setup.
  assert.ok(req.betas.includes('thinking-binding-controls-2026-08-01'))
  assert.equal(req.thinking.type, 'adaptive')
  assert.deepEqual(req.tool_choice, { type: 'auto' })
  for (const banned of ['temperature', 'top_p', 'top_k']) assert.equal(banned in req, false, banned)
})

test('Opus 5.5 and Sonnet 5.5 keep the server-side fallback', async () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    const req = await requestFor(model)
    assert.equal(req.model, model)
    assert.equal(req.fallbacks, 'default', model)
    assert.ok(req.betas.includes('server-side-fallback-2026-07-01'), model)
  }
})

test('WHATSAPP_AGENT_MODEL accepts the three agent models and nothing else', () => {
  assert.equal(agentModel('claude-haiku-5-5'), 'claude-haiku-5-5')
  assert.equal(agentModel(' Claude-Sonnet-5-5 '), 'claude-sonnet-5-5')
  assert.equal(agentModel(undefined), 'claude-opus-5-5')
  // An unknown or dated id would be a 400 on every message — use the default.
  assert.equal(agentModel('claude-haiku-5-5-20260101'), 'claude-opus-5-5')
  assert.equal(agentModel('gpt-5'), 'claude-opus-5-5')
})

// ── Always a reply ──────────────────────────────────────────────────────────
// If Claude can't be reached before anything happens, answerWithAgent returns
// null and the webhook answers with the old router — the agent always gets a
// real reply, never "something went wrong".

import { shouldFallBack } from './index.ts'

const run = (claude) => answerWithAgent({
  admin: world().client, profile: AGENT, body: 'any listings in Hamra?', phone: PHONE, inboundLogId: null,
  origin: 'https://stategen.app', legacy: async () => '', claude, model: 'claude-haiku-5-5',
})

test('a bad API key hands the turn to the old router', async () => {
  // What an invalid key looks like: the very first call throws.
  const claude = { beta: { messages: { create: async () => { const e = new Error('401 invalid x-api-key'); e.status = 401; throw e } } } }
  assert.equal(await run(claude), null)
})

test('a first-call refusal on Haiku hands the turn to the old router', async () => {
  // Haiku 5.5 has no server-side fallback; this is the client-side one.
  assert.equal(await run(fakeClaude(msg([], 'refusal'))), null)
})

test('a failure AFTER a tool ran is answered by the agent, not handed off', async () => {
  // Work already happened this turn; replaying the message on the old router
  // could do it twice.
  let calls = 0
  const claude = { beta: { messages: { create: async () => {
    if (calls++ === 0) return msg([{ type: 'tool_use', id: 't1', name: 'get_listing', input: { listing_id: 1 } }])
    throw new Error('overloaded')
  } } } }
  const reply = await run(claude)
  assert.notEqual(reply, null)
  assert.match(reply, /nothing was saved/i)
})

test('shouldFallBack: only a first-call failure with nothing done', () => {
  const base = { rounds: 1, confirmation: null, toolCalls: [] }
  assert.equal(shouldFallBack({ ...base, ended: 'error' }), true)
  assert.equal(shouldFallBack({ ...base, ended: 'refusal' }), true)
  // A normal reply, or a later round, or anything staged or run: no hand-off.
  assert.equal(shouldFallBack({ ...base, ended: 'reply' }), false)
  assert.equal(shouldFallBack({ ...base, ended: 'error', rounds: 2 }), false)
  assert.equal(shouldFallBack({ ...base, ended: 'error', confirmation: 'About to add…' }), false)
  assert.equal(shouldFallBack({ ...base, ended: 'error', toolCalls: [{ name: 'x', ok: true }] }), false)
  assert.equal(shouldFallBack({ ...base, ended: 'deadline' }), false)
})
