// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/agent/tools.test.mjs
//
// The agent's tools against a fake database. The schemas are checked against
// the API's rules, because a schema the API rejects fails every message;
// the write tools are checked to only ever STAGE, never save, and to hold the
// permission and one-change-at-a-time rules no matter what the model asks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from '../fake-db.mjs'
import { briefFromIntent } from '../match-query.ts'
import { NOTHING_WAITING } from './tools.ts'
import { TOOLS, conform, WRITE_TOOLS, executeTool, matchIntent, ALREADY_STAGED, STAGED_PREFIX } from './tools.ts'

const COMPANY = 7
const AGENT = { id: 'p-jad', company_id: COMPANY, role: 'agent', agent_code: 'JH-655', Full_name: 'Jad Habchi' }
const MANAGER = { id: 'p-mgr', company_id: COMPANY, role: 'owner', agent_code: 'MGR-1', Full_name: 'Equity Manager' }

const PROFILES = [
  { id: 'p-jad', company_id: COMPANY, agent_code: 'JH-655', Full_name: 'Jad Habchi', role: 'agent' },
  { id: 'p-nour', company_id: COMPANY, agent_code: 'NH-1', Full_name: 'Nour Haddad', role: 'agent' },
  { id: 'p-mgr', company_id: COMPANY, agent_code: 'MGR-1', Full_name: 'Equity Manager', role: 'owner' },
  { id: 'p-admin', company_id: COMPANY, agent_code: null, Full_name: 'Office Admin', role: 'owner' },
]

function setup(profile, tables = {}, legacy = async () => 'legacy reply') {
  const db = fakeDb({
    pending_actions: [], conversation_state: [], client_requests: [], Properties: [],
    Profiles: PROFILES, Companies: [{ id: COMPANY, title_template: null }],
    ...tables,
  }, {
    // What Postgres fills in: a prepared change lives 10 minutes.
    defaults: { pending_actions: () => ({ created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString() }) },
  })
  return { db, ctx: { admin: db.client, profile, origin: 'https://stategen.app', legacy } }
}
const fresh = () => ({ staged: false })

/** Every field null, then the ones given — what a strict tool call looks like. */
function call(name, given) {
  const tool = TOOLS.find(t => t.name === name)
  return Object.fromEntries(Object.keys(tool.input_schema.properties).map(k => [k, given[k] ?? null]))
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const FORBIDDEN = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']

function walk(schema, path, problems) {
  for (const k of FORBIDDEN) if (k in schema) problems.push(`${path}: "${k}" is not supported by strict tool use`)
  const types = [].concat(schema.type ?? [])
  // Every enum value must match a single declared type — the API 400s on an
  // enum beside a type list, which took the agent down on every message.
  if (schema.enum && (types.length !== 1 || schema.enum.some(v => typeof v !== types[0])))
    problems.push(`${path}: enum needs exactly one type that all its values match (use anyOf for null)`)
  for (const [i, sub] of (schema.anyOf ?? []).entries()) walk(sub, `${path}|${i}`, problems)
  if (types.includes('object')) {
    if (schema.additionalProperties !== false) problems.push(`${path}: objects need additionalProperties: false`)
    const keys = Object.keys(schema.properties ?? {})
    const required = new Set(schema.required ?? [])
    // Nullable means optional; anything that can't be null must be required.
    for (const k of keys) {
      const p = schema.properties[k]
      const nullable = [].concat(p.type ?? []).includes('null') || (p.anyOf ?? []).some(o => o.type === 'null')
      if (nullable === required.has(k)) problems.push(`${path}.${k}: ${nullable ? 'nullable fields are optional' : 'non-null fields must be required'}`)
    }
    for (const k of keys) walk(schema.properties[k], `${path}.${k}`, problems)
  }
  if (types.includes('array') && schema.items) walk(schema.items, `${path}[]`, problems)
}

test('every tool schema follows strict tool use\'s rules', () => {
  const problems = []
  for (const t of TOOLS) walk(t.input_schema, t.name, problems)
  assert.deepEqual(problems, [])
})

test('tools are well-formed: not strict, unique names, real descriptions', () => {
  const names = TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, names.length, 'duplicate tool name')
  for (const t of TOOLS) {
    // Strict mode caps a request at 16 nullable fields; these tools have far
    // more, and the API rejected every message. conform() + the readers do the job.
    assert.notEqual(t.strict, true, `${t.name} must not be strict`)
    assert.match(t.name, /^[a-z_]+$/)
    assert.ok(t.description.length > 40, `${t.name} needs a real description`)
  }
})

test('every tool that can stage a change is treated as a write', () => {
  for (const name of ['create_client', 'create_listing', 'update_client', 'update_listing', 'other_request']) {
    assert.ok(WRITE_TOOLS.has(name), name)
  }
  for (const name of ['find_client', 'find_listings', 'match_listings', 'get_listing']) {
    assert.equal(WRITE_TOOLS.has(name), false, name)
  }
})

// ── create_client ───────────────────────────────────────────────────────────

const RITA = {
  name: 'Rita Haddad', phone: '70 123 456', client_type: 'renter', property_type: 'apartment',
  areas: ['Kaslik', 'Jounieh'], budget: 600, beds: 2, furnishing: 'Furnished', balcony: true,
  features: ['pets allowed'], notes: 'Has a small dog',
}

test('a complete client brief is staged, not saved', async () => {
  const { db, ctx } = setup(AGENT)
  const out = await executeTool(ctx, 'create_client', call('create_client', RITA), fresh())

  assert.ok(out.confirmation, out.content)
  assert.match(out.confirmation, /About to add a new client/)
  assert.match(out.confirmation, /Rita Haddad/)
  assert.ok(out.content.startsWith(STAGED_PREFIX))
  // Exactly one pending action, aimed at client_requests — and no client row.
  const pending = db.table('pending_actions')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].payload.table, 'client_requests')
  assert.equal(db.table('client_requests').length, 0, 'nothing may be written before the yes')
})

test('a client brief with gaps names every missing field at once', async () => {
  // The old flow asked one question at a time; the agent asks for all of it.
  const { db, ctx } = setup(AGENT)
  const out = await executeTool(ctx, 'create_client', call('create_client', { name: 'Rita', property_type: 'apartment' }), fresh())
  assert.equal(out.confirmation, undefined)
  assert.match(out.content, /still needed/)
  for (const field of ['Phone', 'Budget']) assert.match(out.content, new RegExp(field))
  assert.equal(db.table('pending_actions').length, 0)
})

test('a manager adding a client is asked whose it is', async () => {
  const { db, ctx } = setup(MANAGER)
  const out = await executeTool(ctx, 'create_client', call('create_client', RITA), fresh())
  assert.equal(out.confirmation, undefined)
  assert.match(out.content, /assigned to an agent/)
  assert.match(out.content, /Jad Habchi \(JH-655\)/)
  // Someone with no agent code can't own a client, so isn't offered.
  assert.equal(out.content.includes('Office Admin'), false)
  assert.equal(db.table('pending_actions').length, 0)
})

test('a manager naming the agent gets it staged and assigned', async () => {
  for (const named of ['Jad', 'jad habchi', 'JH-655']) {
    const { ctx } = setup(MANAGER)
    const out = await executeTool(ctx, 'create_client', call('create_client', { ...RITA, for_agent: named }), fresh())
    assert.ok(out.confirmation, `${named}: ${out.content}`)
    assert.match(out.confirmation, /Assigned to: Jad Habchi/, named)
  }
})

test('an agent name that fits two people is asked about, not guessed', async () => {
  // "ha" is in both Jad Habchi and Nour Haddad.
  const { db, ctx } = setup(MANAGER)
  const out = await executeTool(ctx, 'create_client', call('create_client', { ...RITA, for_agent: 'ha' }), fresh())
  assert.equal(out.confirmation, undefined)
  assert.match(out.content, /isn't one of the agency's agents/)
  assert.equal(db.table('pending_actions').length, 0)
})

// ── One change at a time ────────────────────────────────────────────────────

test('no write tool runs once a change is staged this turn', async () => {
  // stage() keeps one live action, so a second write would replace the one
  // the agent is about to see and approve.
  for (const name of [...WRITE_TOOLS]) {
    let legacyCalled = false
    const { db, ctx } = setup(AGENT, {}, async () => { legacyCalled = true; return 'x' })
    const out = await executeTool(ctx, name, call(name, RITA), { staged: true })
    assert.equal(out.content, ALREADY_STAGED, name)
    assert.equal(out.isError, true, name)
    assert.equal(db.table('pending_actions').length, 0, name)
    assert.equal(legacyCalled, false, name)
  }
})

test('reads still work after a change is staged', async () => {
  const { ctx } = setup(AGENT)
  const out = await executeTool(ctx, 'get_listing', call('get_listing', { listing_id: 999 }), { staged: true })
  assert.notEqual(out.content, ALREADY_STAGED)
})

// ── Updates keep the existing permission rules ──────────────────────────────

const listing = (agentId) => ({ id: 45, company_id: COMPANY, Title: 'Apartment for sale', Status: 'Available', Amenities: JSON.stringify({ agentId }) })

test('a listing another agent owns cannot be changed', async () => {
  const { db, ctx } = setup(AGENT, { Properties: [listing('NH-1')] })
  const out = await executeTool(ctx, 'update_listing', call('update_listing', { listing_id: 45, status: 'Sold' }), fresh())
  assert.equal(out.confirmation, undefined)
  assert.match(out.content, /another agent/)
  assert.equal(db.table('pending_actions').length, 0)
})

test('your own listing\'s change is staged', async () => {
  const { db, ctx } = setup(AGENT, { Properties: [listing('JH-655')] })
  const out = await executeTool(ctx, 'update_listing', call('update_listing', { listing_id: 45, status: 'Sold' }), fresh())
  assert.ok(out.confirmation, out.content)
  assert.match(out.confirmation, /Sold/)
  assert.equal(db.table('pending_actions').length, 1)
  // The listing itself is untouched until the yes.
  assert.equal(db.table('Properties')[0].Status, 'Available')
})

// ── The bridge to the existing router ───────────────────────────────────────

test('other_request passes the instruction through and reports what it staged', async () => {
  let received = null
  const legacy = async (instruction) => {
    received = instruction
    // The old router staging a deal move, as stage() would.
    await db.client.from('pending_actions').insert({ profile_id: AGENT.id, company_id: COMPANY, summary: 'About to move Ahmed to Negotiating.\n\nReply YES to save or NO to cancel.' })
    return 'About to move Ahmed to Negotiating.\n\nReply YES to save or NO to cancel.'
  }
  const { db, ctx } = setup(AGENT, {}, legacy)
  const out = await executeTool(ctx, 'other_request', call('other_request', { instruction: 'move Ahmed to negotiating' }), fresh())
  assert.equal(received, 'move Ahmed to negotiating')
  assert.match(out.confirmation, /move Ahmed to Negotiating/)
})

test('other_request that only reads stages nothing', async () => {
  const { ctx } = setup(AGENT, {}, async () => 'Today: viewing with Rita at 3pm.')
  const out = await executeTool(ctx, 'other_request', call('other_request', { instruction: 'my schedule today' }), fresh())
  assert.equal(out.confirmation, undefined)
  assert.equal(out.content, 'Today: viewing with Rita at 3pm.')
})

test('a pending action left from an earlier turn is not mistaken for a new one', async () => {
  // Staging is detected by a NEW row, so a read that leaves an old pending
  // action in place reports nothing staged.
  const { ctx } = setup(AGENT, { pending_actions: [{ id: 1, profile_id: AGENT.id, company_id: COMPANY, summary: 'old' }] },
    async () => 'Today: nothing booked.')
  const out = await executeTool(ctx, 'other_request', call('other_request', { instruction: 'my schedule today' }), fresh())
  assert.equal(out.confirmation, undefined)
})

// ── match_listings' brief ───────────────────────────────────────────────────

test('match_listings keeps features as a list, so the matcher actually uses them', () => {
  // A joined string was silently dropped by briefFromIntent's list().
  const intent = matchIntent(call('match_listings', {
    transaction: 'For Rent', property_type: 'apartment', areas: ['Jounieh', 'Kaslik'],
    budget: 800, beds: 2, features: ['parking', 'elevator'],
  }))
  const brief = briefFromIntent(intent)
  assert.equal(brief.req.transaction, 'For Rent')
  assert.equal(brief.req.type, 'Apartment')
  assert.deepEqual(brief.req.locations, ['Jounieh', 'Kaslik'])
  assert.equal(brief.budget, 800)
  assert.equal(brief.req.beds, 2)
  assert.deepEqual(brief.req.amenities, ['parking', 'elevator'])
})

// ── Malformed calls ─────────────────────────────────────────────────────────

test('a call missing its key field is refused, not guessed', async () => {
  const { ctx } = setup(AGENT)
  for (const [name, given] of [['find_client', {}], ['get_listing', {}], ['update_client', {}], ['update_listing', {}], ['other_request', {}]]) {
    const out = await executeTool(ctx, name, call(name, given), fresh())
    assert.equal(out.isError, true, name)
  }
})

test('an unknown tool is refused', async () => {
  const { ctx } = setup(AGENT)
  const out = await executeTool(ctx, 'delete_everything', {}, fresh())
  assert.equal(out.isError, true)
})

// ── Replacing a waiting change ──────────────────────────────────────────────

import { REPLACED_NOTE } from './tools.ts'

test('a correction to a waiting change is staged, and the model is told it replaced it', async () => {
  // "yes but she's a renter" reaches the agent, which re-prepares the client.
  // stage() drops the waiting one; the model must know that happened.
  const { db, ctx } = setup(AGENT, {
    pending_actions: [{ id: 50, profile_id: AGENT.id, company_id: COMPANY, summary: 'About to add a new client: Rita (buyer)' }],
  })
  const out = await executeTool(ctx, 'create_client', call('create_client', RITA), fresh())
  assert.ok(out.confirmation)
  assert.ok(out.content.startsWith(REPLACED_NOTE), out.content)
  assert.equal(db.table('pending_actions').length, 1, 'still exactly one waiting change')
  assert.notEqual(db.table('pending_actions')[0].id, 50)
})

test('with nothing waiting, no replacement is mentioned', async () => {
  const { ctx } = setup(AGENT)
  const out = await executeTool(ctx, 'create_client', call('create_client', RITA), fresh())
  assert.equal(out.content.includes(REPLACED_NOTE), false)
})

test('conform snaps choices to their listed value and drops the rest', () => {
  assert.deepEqual(conform('match_listings', { transaction: 'for rent' }).transaction, 'For Rent')
  assert.equal(conform('match_listings', { transaction: 'rent please' }).transaction, undefined)
  assert.equal(conform('create_listing', { furnishing: 'semi furnished' }).furnishing, 'Semi-furnished')
  assert.equal(conform('update_client', { status: 'NEGOTIATING' }).status, 'Negotiating')
  // Non-choice fields pass through untouched.
  assert.equal(conform('match_listings', { areas: ['Achrafieh'] }).areas[0], 'Achrafieh')
})

test('two clients with one name: client_area picks the one meant, even from an area list', async () => {
  // Live: "Rita Haddad the Achrafieh one, budget 1000" — the agent had no way
  // to say which Rita, and "in Achrafieh, Gemmayzeh" didn't parse.
  const { db, ctx } = setup(MANAGER, {
    client_requests: [
      { id: 31, company_id: COMPANY, 'Client Name': 'Rita Haddad', 'prefered-location': 'Tyre', budget_max: 825000, notes: '{"agentId":"JH-655"}' },
      { id: 145, company_id: COMPANY, 'Client Name': 'Rita Haddad', 'prefered-location': 'Achrafieh, Gemmayzeh', budget_max: 900, notes: '{"agentId":"JH-655"}' },
    ],
  })
  for (const client_area of ['Achrafieh', 'Achrafieh, Gemmayzeh']) {
    db.table('pending_actions').length = 0
    const out = await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Rita Haddad', client_area, budget: 1000 }), fresh())
    assert.ok(out.confirmation, `${client_area}: ${out.content}`)
    assert.equal(db.table('pending_actions').at(-1).payload.id, 145)
  }
  // Without the area it still asks, rather than guessing.
  db.table('pending_actions').length = 0
  const ask = await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Rita Haddad', budget: 1000 }), fresh())
  assert.equal(ask.confirmation, undefined)
})

test('a client can be found and updated by phone, however it is typed', async () => {
  // Live: "searching by her phone number didn't find her" — the lookup only
  // ever searched names.
  const { db, ctx } = setup(MANAGER, {
    client_requests: [
      { id: 31, company_id: COMPANY, 'Client Name': 'Rita Haddad', 'client phone': '03 555 666', 'prefered-location': 'Tyre', notes: '{"agentId":"JH-655"}' },
      { id: 145, company_id: COMPANY, 'Client Name': 'Rita Haddad', 'client phone': '70 123 456', 'prefered-location': 'Achrafieh, Gemmayzeh', notes: '{"agentId":"JH-655"}' },
    ],
  })
  const found = await executeTool(ctx, 'find_client', call('find_client', { name: '+961 70123456' }), fresh())
  assert.match(found.content, /Achrafieh/)
  assert.doesNotMatch(found.content, /Tyre/)
  const out = await executeTool(ctx, 'update_client', call('update_client', { client_name: '70 123 456', budget: 1000 }), fresh())
  assert.ok(out.confirmation, out.content)
  assert.equal(db.table('pending_actions').at(-1).payload.id, 145)
  const none = await executeTool(ctx, 'find_client', call('find_client', { name: '71 999 000' }), fresh())
  assert.match(none.content, /No client/)
})

// ── Approving with more words than "yes" ────────────────────────────────────
// Live (simulator): "Yes, that's correct, please save it" reached the agent,
// which had no way to save — and told the agent it was "confirmed on my side".

const RITA_145 = { id: 145, company_id: COMPANY, 'Client Name': 'Rita Haddad', 'client phone': '70 123 456', 'prefered-location': 'Achrafieh', budget_max: 900, budget_min: 900, notes: '{"agentId":"JH-655"}' }

test('confirm_waiting_change saves exactly the change the agent was shown', async () => {
  const { db, ctx } = setup(AGENT, { client_requests: [{ ...RITA_145 }] })
  const staged = await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Rita Haddad', budget: 1000 }), fresh())
  assert.ok(staged.confirmation)
  // The next message — a new turn.
  const out = await executeTool(ctx, 'confirm_waiting_change', {}, fresh())
  assert.equal(out.isError, undefined, out.content)
  assert.match(out.confirmation, /saved|updated/i)
  assert.equal(Number(db.table('client_requests')[0].budget_max), 1000)
  assert.equal(db.table('pending_actions').length, 0, 'consumed')
  // Twice is nothing: it can never be applied again.
  const again = await executeTool(ctx, 'confirm_waiting_change', {}, fresh())
  assert.equal(again.content, NOTHING_WAITING)
})

test('a change prepared in the same reply cannot be confirmed — the agent has not seen it', async () => {
  const { db, ctx } = setup(AGENT, { client_requests: [{ ...RITA_145 }] })
  const state = fresh()
  await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Rita Haddad', budget: 1000 }), state)
  state.staged = true   // what the loop does when a tool stages
  const out = await executeTool(ctx, 'confirm_waiting_change', {}, state)
  assert.equal(out.isError, true)
  assert.equal(Number(db.table('client_requests')[0].budget_max), 900)
})

test('an expired change is not saved', async () => {
  const { db, ctx } = setup(AGENT, { client_requests: [{ ...RITA_145 }] })
  await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Rita Haddad', budget: 1000 }), fresh())
  db.table('pending_actions')[0].expires_at = new Date(Date.now() - 1000).toISOString()
  const out = await executeTool(ctx, 'confirm_waiting_change', {}, fresh())
  assert.equal(out.content, NOTHING_WAITING)
  assert.equal(Number(db.table('client_requests')[0].budget_max), 900)
})

test('cancel_waiting_change drops it and saves nothing', async () => {
  const { db, ctx } = setup(AGENT, { client_requests: [{ ...RITA_145 }] })
  await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Rita Haddad', budget: 1000 }), fresh())
  const out = await executeTool(ctx, 'cancel_waiting_change', {}, fresh())
  assert.match(out.confirmation, /Cancelled/)
  assert.equal(db.table('pending_actions').length, 0)
  assert.equal(Number(db.table('client_requests')[0].budget_max), 900)
  assert.equal((await executeTool(ctx, 'cancel_waiting_change', {}, fresh())).content, NOTHING_WAITING)
})

test('a number sent as text ("1,000") is read', async () => {
  const { ctx } = setup(AGENT, { client_requests: [{ ...RITA_145 }] })
  const out = await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Rita Haddad', budget: '1,000' }), fresh())
  assert.ok(out.confirmation, out.content)
  assert.match(out.confirmation, /1,000/)
})

// ── Bookings and deal moves as exact fields ─────────────────────────────────
// Through other_request they were a sentence the old router re-read: the
// simulator saw "tomorrow at 4pm" become today, and every deal move come back
// as the pipeline overview.

import { whenAt } from '../calendar-handlers.ts'

const beirutDay = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date(Date.now() + offsetDays * 86_400_000))

test('whenAt reads an exact Beirut date and time, and nothing else', () => {
  // 4pm in Beirut: UTC+3 in summer, UTC+2 from 25 Oct 2026 (the clocks
  // change that night) — both sides of it.
  assert.equal(whenAt('2026-08-10', '16:00').start.toISOString(), '2026-08-10T13:00:00.000Z')
  assert.equal(whenAt('2026-10-25', '16:00').start.toISOString(), '2026-10-25T14:00:00.000Z')
  const w = whenAt('2026-11-10', '16:00')
  assert.equal(w.allDay, false)
  assert.equal(whenAt('2026-10-25', null).allDay, true)
  for (const [d, t] of [['25/10/2026', '16:00'], ['2026-02-31', null], ['2026-10-25', '4pm'], ['2026-10-25', '25:00'], ['tomorrow', null]]) {
    assert.equal(whenAt(d, t), null, `${d} ${t}`)
  }
})

test('book_event stages the event for the exact day and time given', async () => {
  const { db, ctx } = setup(AGENT)
  const tomorrow = beirutDay(1)
  const out = await executeTool(ctx, 'book_event', call('book_event', { kind: 'viewing', date: tomorrow, time: '16:00', title: 'Viewing with Rita Haddad — #44' }), fresh())
  assert.ok(out.confirmation, out.content)
  const row = db.table('pending_actions').at(-1).payload.columns
  assert.equal(row.kind, 'viewing')
  assert.equal(row.title, 'Viewing with Rita Haddad — #44')
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date(row.starts_at)), tomorrow)
  assert.equal(db.table('calendar_events').length, 0, 'only staged')
})

test('book_event refuses a past day and a malformed one', async () => {
  const { db, ctx } = setup(AGENT)
  for (const date of [beirutDay(-2), 'next friday']) {
    const out = await executeTool(ctx, 'book_event', call('book_event', { kind: 'meeting', date, time: '10:00', title: 'Meeting' }), fresh())
    assert.equal(out.isError, true, date)
  }
  assert.equal(db.table('pending_actions').length, 0)
})

test('move_deal stages the stage change, and "won" closes the deal as won', async () => {
  const deals = () => [{ id: 'd-1', company_id: COMPANY, client_id: 145, agent_id: 'JH-655', stage: 'lead', outcome: null, value: 0 }]
  for (const [stage, expect] of [['negotiating', { stage: 'negotiating' }], ['won', { stage: 'closed', outcome: 'won' }]]) {
    const { db, ctx } = setup(AGENT, { client_requests: [{ ...RITA_145 }], deals: deals() })
    const out = await executeTool(ctx, 'move_deal', call('move_deal', { client_name: 'Rita Haddad', stage }), fresh())
    assert.ok(out.confirmation, `${stage}: ${out.content}`)
    const payload = db.table('pending_actions').at(-1).payload
    for (const [k, v] of Object.entries(expect)) assert.equal(payload.columns[k], v, `${stage} ${k}`)
  }
})

test('find_client picks one of two same-named clients by area', async () => {
  const { ctx } = setup(MANAGER, {
    client_requests: [
      { id: 31, company_id: COMPANY, 'Client Name': 'Rita Haddad', 'prefered-location': 'Tyre', notes: '{"agentId":"JH-655"}' },
      { ...RITA_145, 'prefered-location': 'Achrafieh, Gemmayzeh' },
    ],
  })
  const both = await executeTool(ctx, 'find_client', call('find_client', { name: 'Rita Haddad' }), fresh())
  assert.match(both.content, /2 clients/)
  const one = await executeTool(ctx, 'find_client', call('find_client', { name: 'Rita Haddad', client_area: 'Achrafieh/Gemmayzeh' }), fresh())
  assert.doesNotMatch(one.content, /Tyre/)
  assert.match(one.content, /Achrafieh/)
})

test('two records with the same name AND area are picked by number', async () => {
  // Live (simulator, Equity-like data): "Joe Khoury — Achrafieh" and "Joe
  // Khoury — Beirut, Achrafieh" — no area separates them.
  const joe = (id, area) => ({ id, company_id: COMPANY, 'Client Name': 'Joe Khoury', 'prefered-location': area, budget_max: 500000, budget_min: 500000, notes: '{"agentId":"JH-655"}' })
  const { db, ctx } = setup(AGENT, { client_requests: [joe(40, 'Beirut, Achrafieh'), joe(41, 'Achrafieh')] })
  const list = await executeTool(ctx, 'find_client', call('find_client', { name: 'Joe Khoury', client_area: 'Achrafieh' }), fresh())
  assert.match(list.content, /#40/)
  assert.match(list.content, /#41/)
  const one = await executeTool(ctx, 'find_client', call('find_client', { name: '#41' }), fresh())
  assert.doesNotMatch(one.content, /2 clients/)
  const out = await executeTool(ctx, 'update_client', call('update_client', { client_name: '#41', budget: 600000 }), fresh())
  assert.ok(out.confirmation, out.content)
  assert.equal(db.table('pending_actions').at(-1).payload.id, 41)
})

import { nameSkeleton } from '../handlers.ts'

test('names match across Lebanese transliterations', () => {
  for (const [a, b] of [['Youssef', 'Yousef'], ['Ziade', 'Ziadeh'], ['Ziadé', 'ziade'], ['Charbel', 'Sharbel'.replace('Sh', 'Ch')], ['Rita', 'Reeta']]) {
    assert.equal(nameSkeleton(a), nameSkeleton(b), `${a} ~ ${b}`)
  }
  assert.notEqual(nameSkeleton('Rita'), nameSkeleton('Rana'))
})

test('a client is found under another spelling of their name — and updated', async () => {
  // Live (simulator, Equity): "Yousef Ziade", "Youssef Ziadeh" and two more
  // spellings all missed "Youssef ziade".
  const youssef = { id: 77, company_id: COMPANY, 'Client Name': 'Youssef ziade', 'prefered-location': 'Metn', budget_max: 300000, budget_min: 300000, notes: '{"agentId":"JH-655"}' }
  const { db, ctx } = setup(AGENT, { client_requests: [youssef, { ...RITA_145 }] })
  const found = await executeTool(ctx, 'find_client', call('find_client', { name: 'Yousef Ziadeh' }), fresh())
  assert.match(found.content, /Youssef ziade/i)
  const out = await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Yousef Ziadeh', budget: 350000 }), fresh())
  assert.ok(out.confirmation, out.content)
  assert.equal(db.table('pending_actions').at(-1).payload.id, 77)
  // A different person is still not found.
  const none = await executeTool(ctx, 'find_client', call('find_client', { name: 'Rana Ziade' }), fresh())
  assert.match(none.content, /No client/)
})

test('add_client_note: the note lands in the Notes the app shows, the rest of the request untouched', async () => {
  // Live (simulator): "log a note on Reem's file" — the agent had no way to,
  // and the old feedback log it could have used is shown nowhere in the app.
  const reem = { id: 88, company_id: COMPANY, 'Client Name': 'Reem Frangieh', 'prefered-location': 'Beirut', budget_max: 1000000,
    notes: JSON.stringify({ agentId: 'JH-655', req: { notes: 'Wants a sea view.', locations: ['Beirut'], size: 120 } }) }
  const { db, ctx } = setup(AGENT, { client_requests: [reem] })
  const staged = await executeTool(ctx, 'add_client_note', call('add_client_note', { client_name: 'Reem Frangieh', note: '#24 and #60 both pending a viewing.' }), fresh())
  assert.ok(staged.confirmation, staged.content)
  assert.match(staged.confirmation, /Add note: "#24 and #60 both pending a viewing\."/)
  // Someone edits the notes on the web while the note waits on "yes".
  const row = db.table('client_requests')[0]
  row.notes = JSON.stringify({ ...JSON.parse(row.notes), req: { ...JSON.parse(row.notes).req, notes: 'Wants a sea view. Has a dog.' } })
  const saved = await executeTool(ctx, 'confirm_waiting_change', {}, fresh())
  assert.match(saved.confirmation, /Saved/)
  const req = JSON.parse(db.table('client_requests')[0].notes).req
  assert.match(req.notes, /^Wants a sea view\. Has a dog\.\n\d{1,2} [A-Z][a-z]{2}: #24 and #60 both pending a viewing\.$/)
  assert.deepEqual(req.locations, ['Beirut'])
  assert.equal(req.size, 120)
  assert.equal(JSON.parse(db.table('client_requests')[0].notes).agentId, 'JH-655')
})

test('a client can switch from buying to renting — both places the app keeps it', async () => {
  // Live (simulator): "I can't switch her from buyer to renter here", twice.
  const manale = { id: 61, company_id: COMPANY, 'Client Name': 'Manale', payment_terms: 'For Sale', budget_max: 250000,
    notes: JSON.stringify({ agentId: 'JH-655', type: 'Buyer', req: { notes: 'x' } }) }
  const { db, ctx } = setup(AGENT, { client_requests: [manale] })
  const staged = await executeTool(ctx, 'update_client', call('update_client', { client_name: 'Manale', client_type: 'renter', budget: 1200 }), fresh())
  assert.ok(staged.confirmation, staged.content)
  await executeTool(ctx, 'confirm_waiting_change', {}, fresh())
  const row = db.table('client_requests')[0]
  assert.equal(row.payment_terms, 'For Rent')
  assert.equal(JSON.parse(row.notes).type, 'Renter')
  assert.equal(JSON.parse(row.notes).req.notes, 'x', 'the rest of the blob is kept')
  assert.equal(Number(row.budget_max), 1200)
})
