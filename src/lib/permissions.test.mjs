// Unit tests for the manager/agent permission rules (src/lib/permissions.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isManager, owns, canSeeClientPII, canEditClient, canEditProperty,
  canSeeDeal, maskClient, maskClientName,
} from './permissions.ts'

const manager = { userId: 'u1', companyId: 1, role: 'owner', agentCode: null, fullName: 'Boss' }
const agentA2 = { userId: 'u2', companyId: 1, role: 'agent', agentCode: 'a2', fullName: 'Rami' }

// ── roles ───────────────────────────────────────────────────────────────────
test('isManager: owner and manager count, agent does not', () => {
  assert.equal(isManager('owner'), true)
  assert.equal(isManager('manager'), true)
  assert.equal(isManager('agent'), false)
  assert.equal(isManager(null), false)
})

test('owns: matches the agent code, managers own nothing directly', () => {
  assert.equal(owns(agentA2, 'a2'), true)
  assert.equal(owns(agentA2, 'a1'), false)
  assert.equal(owns(agentA2, null), false)
  assert.equal(owns(manager, 'a1'), false) // manager has no agentCode
})

// ── client PII ──────────────────────────────────────────────────────────────
test('canSeeClientPII: manager sees all, agent only their own', () => {
  assert.equal(canSeeClientPII(manager, 'a1'), true)
  assert.equal(canSeeClientPII(manager, 'a3'), true)
  assert.equal(canSeeClientPII(agentA2, 'a2'), true)
  assert.equal(canSeeClientPII(agentA2, 'a1'), false)
})

test('canEditClient: same ownership rule as PII', () => {
  assert.equal(canEditClient(manager, 'a4'), true)
  assert.equal(canEditClient(agentA2, 'a2'), true)
  assert.equal(canEditClient(agentA2, 'a4'), false)
})

// ── properties (view all, edit own) ─────────────────────────────────────────
test('canEditProperty: manager edits any, agent only their own listings', () => {
  assert.equal(canEditProperty(manager, 'a1'), true)
  assert.equal(canEditProperty(agentA2, 'a2'), true)
  assert.equal(canEditProperty(agentA2, 'a1'), false)
})

// ── pipeline visibility ─────────────────────────────────────────────────────
test('canSeeDeal: agent sees only their own deals', () => {
  assert.equal(canSeeDeal(agentA2, 'a2'), true)
  assert.equal(canSeeDeal(agentA2, 'a1'), false)
})

test('canSeeDeal: manager sees everything, and can filter to one agent', () => {
  assert.equal(canSeeDeal(manager, 'a1'), true)
  assert.equal(canSeeDeal(manager, 'a3'), true)
  assert.equal(canSeeDeal(manager, 'a3', 'a3'), true)
  assert.equal(canSeeDeal(manager, 'a1', 'a3'), false) // filtered out
})

test('canSeeDeal: an agent filter never widens an agent beyond their own', () => {
  assert.equal(canSeeDeal(agentA2, 'a1', 'a1'), false)
})

// ── masking ─────────────────────────────────────────────────────────────────
test('maskClientName: stable placeholder from the id', () => {
  assert.equal(maskClientName(42), 'Client #42')
})

test('maskClient: strips name/phone/email, keeps the rest', () => {
  const c = { id: 42, name: 'Sara Stephan', phone: '+961 3 111 222', email: 's@x.com', budget: 500000, agentId: 'a1' }
  const m = maskClient(c)
  assert.equal(m.name, 'Client #42')
  assert.equal(m.phone, '')
  assert.equal(m.email, '')
  assert.equal(m.masked, true)
  assert.equal(m.budget, 500000)   // non-identifying data survives
  assert.equal(m.agentId, 'a1')
  assert.equal(c.name, 'Sara Stephan') // input not mutated
})
