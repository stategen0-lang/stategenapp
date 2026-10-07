// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/agent-login.test.mjs
//
// Turning an Agent ID into the email Supabase Auth knows. This was a real bug
// with no symptom: the resolver rebuilt the address from <code>@<domain>, so an
// account whose stored email didn't follow that pattern failed sign-in with
// "invalid credentials" — which reads as a wrong password, so the manager resets
// it, hands over a fresh one, and it still doesn't work.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './whatsapp/fake-db.mjs'
import { resolveLoginEmail, AMBIGUOUS_ID_ERROR, GENERIC_LOGIN_ERROR } from './agent-login.ts'

/**
 * @param {object[]} profiles
 * @param {object[]} companies
 * @param {Record<string,string|null>} emails profile id -> auth email
 * @param {boolean} [authBroken] the admin API throwing, to exercise the fallback
 */
const db = (profiles, companies, emails, authBroken = false) => {
  const base = fakeDb({ Profiles: profiles, Companies: companies })
  return {
    from: base.client.from,
    auth: {
      admin: {
        getUserById: async (id) => {
          if (authBroken) throw new Error('admin API down')
          const email = emails[id]
          return { data: { user: email === undefined ? null : { email } } }
        },
      },
    },
  }
}

const COMPANY = [{ id: 1, domain: 'test.stategen.app' }]

test('an email is passed straight through', async () => {
  const r = await resolveLoginEmail(db([], [], {}), ' Manager@Agency.com ')
  assert.deepEqual(r, { email: 'Manager@Agency.com' })
})

test('an Agent ID resolves to the account\'s real email, not the rebuilt one', async () => {
  // The exact shape of the live bug: the profile says A2 at test.stategen.app,
  // the account signs in as agent@stategen.app.
  const r = await resolveLoginEmail(
    db([{ id: 'u1', agent_code: 'a2', company_id: 1 }], COMPANY, { u1: 'agent@stategen.app' }),
    'a2',
  )
  assert.deepEqual(r, { email: 'agent@stategen.app' })
})

test('the ordinary case still works, whatever case it is typed in', async () => {
  for (const typed of ['nh-779', 'NH-779', ' Nh-779 ']) {
    const r = await resolveLoginEmail(
      db([{ id: 'u2', agent_code: 'NH-779', company_id: 1 }], COMPANY, { u2: 'nh-779@test.stategen.app' }),
      typed,
    )
    assert.deepEqual(r, { email: 'nh-779@test.stategen.app' }, typed)
  }
})

test('an unknown ID gives nothing away', async () => {
  const r = await resolveLoginEmail(db([{ id: 'u1', agent_code: 'NH-779', company_id: 1 }], COMPANY, {}), 'ZZ-000')
  assert.deepEqual(r, { error: GENERIC_LOGIN_ERROR })
  // Same answer for an ID that isn't even a valid shape, so neither reveals
  // which IDs exist.
  assert.deepEqual(await resolveLoginEmail(db([], [], {}), '!'), { error: GENERIC_LOGIN_ERROR })
})

test('a code used at two agencies asks for the full email', async () => {
  const r = await resolveLoginEmail(
    db(
      [{ id: 'u1', agent_code: 'JD-204', company_id: 1 }, { id: 'u2', agent_code: 'JD-204', company_id: 2 }],
      [...COMPANY, { id: 2, domain: 'other.com' }],
      { u1: 'a@x.com', u2: 'b@y.com' },
    ),
    'JD-204',
  )
  assert.deepEqual(r, { error: AMBIGUOUS_ID_ERROR })
})

test('ilike does not let a pattern match somebody else', async () => {
  // sanitizeAgentCode strips "%" characters anyway, but the exact-compare after
  // the query is what guarantees it: one typed ID, one account.
  const r = await resolveLoginEmail(
    db([{ id: 'u1', agent_code: 'NH-779', company_id: 1 }], COMPANY, { u1: 'nh-779@test.stategen.app' }),
    'NH',
  )
  assert.deepEqual(r, { error: GENERIC_LOGIN_ERROR })
})

test('when the auth API is unreachable it falls back to the convention', async () => {
  // Not a nicety: without it, a blip in the admin API would stop every agent in
  // every agency signing in by ID.
  const r = await resolveLoginEmail(
    db([{ id: 'u2', agent_code: 'NH-779', company_id: 1 }], COMPANY, {}, true),
    'NH-779',
  )
  assert.deepEqual(r, { email: 'nh-779@test.stategen.app' })
})

test('no auth record and no domain is a dead end, not a crash', async () => {
  const r = await resolveLoginEmail(
    db([{ id: 'u3', agent_code: 'XX-1', company_id: 1 }], [{ id: 1, domain: null }], {}),
    'XX-1',
  )
  assert.deepEqual(r, { error: GENERIC_LOGIN_ERROR })
})
