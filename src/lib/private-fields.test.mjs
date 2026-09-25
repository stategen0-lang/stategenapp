// node --experimental-strip-types --test src/lib/private-fields.test.mjs
//
// What leaves the server on a listing row. This is a privacy boundary, not a
// display preference: the fields below are removed from the JSON itself, so a
// colleague cannot read them out of the network tab no matter what the UI does.

import test from 'node:test'
import assert from 'node:assert/strict'
import { stripPrivateFields } from './private-fields.ts'

/** Every private field, on a listing belonging to agent NH-1. */
const row = () => ({
  id: 7,
  Title: 'Sea view apartment',
  Amenities: JSON.stringify({
    agentId: 'NH-1',
    type: 'Appartement',
    amenities: ['Pool'],
    publicNotes: 'New kitchen, quiet street',
    notes: 'Owner is desperate, will take 15% less',
    ownerName: 'Georges Haddad',
    ownerContact: '03 987 654',
    documentPath: 'company-1/deed.pdf',
    documentName: 'deed.pdf',
    mapUrl: 'https://maps.google.com/?q=1,2',
  }),
})

const session = (role, agentCode) => ({ userId: 'u', companyId: 1, role, agentCode, fullName: 'X', approved: true })
const extras = r => JSON.parse(r.Amenities)

const PRIVATE = ['notes', 'ownerName', 'ownerContact', 'documentPath', 'documentName', 'mapUrl']

test('another agent receives none of the private fields', () => {
  const ex = extras(stripPrivateFields(row(), session('agent', 'SM-2')))
  for (const field of PRIVATE) {
    assert.equal(field in ex, false, `${field} was sent to an agent who does not own the listing`)
  }
})

test('the listing agent receives all of them', () => {
  const ex = extras(stripPrivateFields(row(), session('agent', 'NH-1')))
  for (const field of PRIVATE) assert.ok(field in ex, `${field} is missing for the listing's own agent`)
  assert.equal(ex.notes, 'Owner is desperate, will take 15% less')
})

test('a manager receives all of them, whoever listed it', () => {
  for (const role of ['manager', 'owner']) {
    const ex = extras(stripPrivateFields(row(), session(role, 'ZZ-9')))
    for (const field of PRIVATE) assert.ok(field in ex, `${field} is missing for a ${role}`)
  }
})

test('stripping takes nothing else with it', () => {
  // The shared inventory is still shared: everything that is not private stays.
  const ex = extras(stripPrivateFields(row(), session('agent', 'SM-2')))
  assert.equal(ex.type, 'Appartement')
  assert.deepEqual(ex.amenities, ['Pool'])
  assert.equal(ex.agentId, 'NH-1')                       // who owns it is not a secret
  assert.equal(ex.publicNotes, 'New kitchen, quiet street')   // written for clients
  assert.equal(stripPrivateFields(row(), session('agent', 'SM-2')).Title, 'Sea view apartment')
})

test('a row with an unreadable blob is passed through, not lost', () => {
  const broken = { id: 7, Amenities: 'not json' }
  assert.deepEqual(stripPrivateFields(broken, session('agent', 'SM-2')), broken)
  // A listing with no blob at all has nothing to hide and nothing to break.
  const bare = { id: 8 }
  assert.deepEqual(extras(stripPrivateFields(bare, session('agent', 'SM-2'))), {})
})
