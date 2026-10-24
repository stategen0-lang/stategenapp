// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/whatsapp/agent/tools.test.mjs
//
// The agent's tools against a fake database. The schemas are checked against
// strict tool use's rules, because a schema the API rejects fails every message;
// the write tools are checked to only ever STAGE, never save, and to hold the
// permission and one-change-at-a-time rules no matter what the model asks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from '../fake-db.mjs'
import { briefFromIntent } from '../match-query.ts'
import { TOOLS, WRITE_TOOLS, executeTool, matchIntent, ALREADY_STAGED, STAGED_PREFIX } from './tools.ts'

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
  if (types.includes('object')) {
    if (schema.additionalProperties !== false) problems.push(`${path}: objects need additionalProperties: false`)
    const keys = Object.keys(schema.properties ?? {})
    const required = new Set(schema.required ?? [])
    for (const k of keys) if (!required.has(k)) problems.push(`${path}.${k}: every property must be listed in required`)
    for (const k of keys) walk(schema.properties[k], `${path}.${k}`, problems)
  }
  if (types.includes('array') && schema.items) walk(schema.items, `${path}[]`, problems)
}

test('every tool schema follows strict tool use\'s rules', () => {
  const problems = []
  for (const t of TOOLS) walk(t.input_schema, t.name, problems)
  assert.deepEqual(problems, [])
})

test('tools are well-formed: strict, unique names, real descriptions', () => {
  const names = TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, names.length, 'duplicate tool name')
  for (const t of TOOLS) {
    assert.equal(t.strict, true, `${t.name} should be strict`)
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
