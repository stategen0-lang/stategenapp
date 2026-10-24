// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/agent/loop.test.mjs
//
// The agent loop, driven by a scripted fake model. Each rule tested here is one
// that must hold no matter what the model decides to say — they are enforced in
// code precisely so that a wrong guess by the model cannot become a wrong write.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runAgentTurn, composeReply,
  REFUSED_REPLY, TRUNCATED_REPLY, ROUND_LIMIT_REPLY, EMPTY_REPLY, SLOW_REPLY, ERROR_REPLY,
} from './loop.ts'

// ── A scripted model ─────────────────────────────────────────────────────────

const text = t => ({ type: 'text', text: t })
const thinking = () => ({ type: 'thinking', thinking: '', signature: 'sig' })
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input })
const reply = (content, stop_reason) => ({
  id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content, stop_reason: stop_reason ?? (content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
  stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
})

/** Returns the scripted responses in order and records what each call was sent. */
function model(...responses) {
  const sent = []
  return {
    sent,
    call: async messages => {
      sent.push(structuredClone(messages))
      const next = responses.shift()
      if (!next) throw new Error('the model was called more times than scripted')
      return next
    },
  }
}

const USER = [{ role: 'user', content: 'Add client Rita phone 70 123 456' }]
const noTools = async () => { throw new Error('no tool should run') }

// ── Plain conversation ──────────────────────────────────────────────────────

test('a reply with no tool calls is the answer', async () => {
  const m = model(reply([thinking(), text('Hi! What can I do for you?')]))
  const r = await runAgentTurn({ call: m.call, execute: noTools, messages: USER })
  assert.equal(r.reply, 'Hi! What can I do for you?')
  assert.equal(r.ended, 'reply')
  assert.equal(r.rounds, 1)
  assert.equal(r.confirmation, null)
})

test('a response with no text at all gets a safe fallback', async () => {
  const m = model(reply([thinking()]))
  const r = await runAgentTurn({ call: m.call, execute: noTools, messages: USER })
  assert.equal(r.reply, EMPTY_REPLY)
  assert.equal(r.ended, 'empty')
})

// ── Tools ───────────────────────────────────────────────────────────────────

test('a tool runs with the model\'s input and its result goes back', async () => {
  const m = model(
    reply([thinking(), toolUse('t1', 'find_client', { name: 'Rita' })]),
    reply([text('Rita is a renter looking in Hamra.')]),
  )
  const calls = []
  const r = await runAgentTurn({
    call: m.call,
    execute: async (name, input) => { calls.push([name, input]); return { content: 'Rita — renter — Hamra' } },
    messages: USER,
  })
  assert.deepEqual(calls, [['find_client', { name: 'Rita' }]])
  assert.equal(r.reply, 'Rita is a renter looking in Hamra.')
  assert.deepEqual(r.toolCalls, [{ name: 'find_client', ok: true }])
  // Round two saw the tool result.
  const lastSent = m.sent[1].at(-1)
  assert.equal(lastSent.role, 'user')
  assert.deepEqual(lastSent.content, [{ type: 'tool_result', tool_use_id: 't1', content: 'Rita — renter — Hamra' }])
})

test('several tool calls in one response are answered in ONE message, in order', async () => {
  // Splitting results across messages teaches the model to stop calling
  // tools in parallel.
  const m = model(
    reply([toolUse('a', 'find_client', { name: 'Rita' }), toolUse('b', 'find_listings', { area: 'Hamra' })]),
    reply([text('done')]),
  )
  await runAgentTurn({ call: m.call, execute: async name => ({ content: `result of ${name}` }), messages: USER })
  const results = m.sent[1].at(-1)
  assert.equal(results.role, 'user')
  assert.deepEqual(results.content.map(r => r.tool_use_id), ['a', 'b'])
})

test('the conversation is append-only between rounds, thinking blocks included', async () => {
  // Rewriting an earlier message invalidates the thinking blocks that follow it;
  // on new accounts that is a 400, not a degraded answer.
  const first = reply([thinking(), toolUse('t1', 'find_client', { name: 'Rita' })])
  const m = model(first, reply([text('ok')]))
  await runAgentTurn({ call: m.call, execute: async () => ({ content: 'r' }), messages: USER })
  const [round1, round2] = m.sent
  assert.deepEqual(round2.slice(0, round1.length), round1)
  // The assistant turn went back exactly as received.
  assert.deepEqual(round2[round1.length], { role: 'assistant', content: first.content })
})

test('a tool that throws becomes an error result, and the turn carries on', async () => {
  const m = model(
    reply([toolUse('t1', 'find_client', { name: 'Rita' })]),
    reply([text('I could not look that up right now.')]),
  )
  const r = await runAgentTurn({
    call: m.call, execute: async () => { throw new Error('db down') }, messages: USER,
  })
  const result = m.sent[1].at(-1).content[0]
  assert.equal(result.is_error, true)
  assert.match(result.content, /Nothing was changed/)
  assert.deepEqual(r.toolCalls, [{ name: 'find_client', ok: false }])
  assert.equal(r.reply, 'I could not look that up right now.')
})

// ── Staged writes ───────────────────────────────────────────────────────────

const CARD = 'About to add a new client:\n• Name: Rita\n• Phone: 70 123 456\n\nReply YES to save or NO to cancel.'

test('a staged change always ends the reply with the real confirmation', async () => {
  const m = model(
    reply([toolUse('t1', 'create_client', { name: 'Rita' })]),
    // The model claims it is saved. The card below says otherwise, and it is
    // the card the agent acts on.
    reply([text('Got it — Sarba is not in my area list, so I used Jounieh.')]),
  )
  const r = await runAgentTurn({
    call: m.call, execute: async () => ({ content: 'STAGED', confirmation: CARD }), messages: USER,
  })
  assert.equal(r.confirmation, CARD)
  assert.ok(r.reply.endsWith(CARD), r.reply)
  assert.ok(r.reply.startsWith('Got it — Sarba'), 'the model\'s note is kept')
})

test('the confirmation is not shown twice if the model repeated it', async () => {
  const m = model(reply([toolUse('t1', 'create_client', {})]), reply([text(`Here you go:\n${CARD}`)]))
  const r = await runAgentTurn({
    call: m.call, execute: async () => ({ content: 'STAGED', confirmation: CARD }), messages: USER,
  })
  assert.equal(r.reply.split('About to add').length - 1, 1)
})

test('later tools in the same turn are told a change is already staged', async () => {
  // stage() keeps one live action, so a second write would silently replace
  // the first. The executor refuses based on this flag.
  const seen = []
  const m = model(
    reply([toolUse('a', 'create_client', {}), toolUse('b', 'update_listing', {})]),
    reply([text('ok')]),
  )
  await runAgentTurn({
    call: m.call,
    execute: async (name, _input, state) => {
      seen.push([name, state.staged])
      return name === 'create_client' ? { content: 'STAGED', confirmation: CARD } : { content: 'refused', isError: true }
    },
    messages: USER,
  })
  assert.deepEqual(seen, [['create_client', false], ['update_listing', true]])
})

test('a reply with no text still shows the staged confirmation', async () => {
  const m = model(reply([toolUse('t1', 'create_client', {})]), reply([thinking()]))
  const r = await runAgentTurn({
    call: m.call, execute: async () => ({ content: 'STAGED', confirmation: CARD }), messages: USER,
  })
  assert.equal(r.reply, CARD)
})

// ── Turns that cannot end normally ──────────────────────────────────────────

test('a refusal is answered plainly, saying nothing was saved', async () => {
  const m = model(reply([], 'refusal'))
  const r = await runAgentTurn({ call: m.call, execute: noTools, messages: USER })
  assert.equal(r.reply, REFUSED_REPLY)
  assert.equal(r.ended, 'refusal')
})

test('a refusal after a change was staged still shows that change', async () => {
  // The pending action exists; telling the agent "nothing was saved" would be
  // true but would hide the thing their next "yes" commits.
  const m = model(reply([toolUse('t1', 'create_client', {})]), reply([], 'refusal'))
  const r = await runAgentTurn({
    call: m.call, execute: async () => ({ content: 'STAGED', confirmation: CARD }), messages: USER,
  })
  assert.equal(r.reply, CARD)
})

test('a tool call cut off by the token limit is never run', async () => {
  const m = model(reply([toolUse('t1', 'create_client', { name: 'Ri' })], 'max_tokens'))
  const r = await runAgentTurn({ call: m.call, execute: noTools, messages: USER })
  assert.equal(r.reply, TRUNCATED_REPLY)
  assert.equal(r.ended, 'truncated')
  assert.deepEqual(r.toolCalls, [])
})

test('a model that never stops calling tools is stopped', async () => {
  const forever = Array.from({ length: 3 }, (_, i) => reply([toolUse(`t${i}`, 'find_client', {})]))
  const m = model(...forever)
  const r = await runAgentTurn({ call: m.call, execute: async () => ({ content: 'r' }), messages: USER, maxRounds: 3 })
  assert.equal(r.reply, ROUND_LIMIT_REPLY)
  assert.equal(r.ended, 'round_limit')
  assert.equal(m.sent.length, 3)
})

test('a paused turn is resumed with the same content', async () => {
  const paused = reply([text('…')], 'pause_turn')
  const m = model(paused, reply([text('finished')]))
  const r = await runAgentTurn({ call: m.call, execute: noTools, messages: USER })
  assert.equal(r.reply, 'finished')
  assert.deepEqual(m.sent[1].at(-1), { role: 'assistant', content: paused.content })
})

// ── composeReply on its own ─────────────────────────────────────────────────

test('composeReply: no confirmation is just the text', () => {
  assert.equal(composeReply('  hello  ', null), 'hello')
  assert.equal(composeReply('', CARD), CARD)
  assert.equal(composeReply('note', CARD), `note\n\n${CARD}`)
})

// ── Time and failure ────────────────────────────────────────────────────────

test('no new round starts after the deadline', async () => {
  // The turn runs inside after(); the platform kills it at maxDuration. An
  // apology beats silence.
  let t = 0
  const m = model(reply([toolUse('t1', 'find_client', {})]), reply([text('never reached')]))
  const r = await runAgentTurn({
    call: m.call,
    execute: async () => { t = 100; return { content: 'r' } },   // the tool "takes" until after the deadline
    messages: USER, deadline: 50, now: () => t,
  })
  assert.equal(r.reply, SLOW_REPLY)
  assert.equal(r.ended, 'deadline')
  assert.equal(m.sent.length, 1)
})

test('a failed model call is answered, not thrown', async () => {
  const r = await runAgentTurn({
    call: async () => { throw new Error('overloaded') }, execute: noTools, messages: USER,
  })
  assert.equal(r.reply, ERROR_REPLY)
  assert.equal(r.ended, 'error')
})

test('a staged change survives a later failure or deadline', async () => {
  // Round one staged a change; round two's call fails. The pending action is
  // real, so the agent sees it — not "nothing was saved".
  let calls = 0
  const r = await runAgentTurn({
    call: async () => {
      if (calls++ === 0) return reply([toolUse('t1', 'create_client', {})])
      throw new Error('network')
    },
    execute: async () => ({ content: 'STAGED', confirmation: CARD }),
    messages: USER,
  })
  assert.equal(r.reply, CARD)
  assert.equal(r.ended, 'error')
})

test('describeError: status, API error type and message on one line', async () => {
  const { describeError } = await import('./loop.ts')
  const apiErr = Object.assign(new Error('raw'), { status: 400, error: { error: { type: 'invalid_request_error', message: 'tools.0: bad\nschema' } } })
  assert.equal(describeError(apiErr), '400 invalid_request_error: tools.0: bad schema')
  assert.equal(describeError(new Error('fetch failed')), 'fetch failed')
  assert.equal(describeError('x'.repeat(500)).length, 200)
})
