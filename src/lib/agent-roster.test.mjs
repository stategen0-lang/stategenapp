// Unit tests for the pipeline agent roster (src/lib/agent-roster.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRoster, findAgent, unknownAgent, initialsOf, displayName, colorFor,
} from './agent-roster.ts'

const KNOWN = [
  { id: 'a1', name: 'Lara Khoury', initials: 'LK', color: '#5E8FD6' },
  { id: 'a2', name: 'Rami Saad', initials: 'RS', color: '#1F8A5B' },
]

// ── Names and initials ──────────────────────────────────────────────────────
test('initialsOf: first and last initial', () => {
  assert.equal(initialsOf('Rami Saad'), 'RS')
  assert.equal(initialsOf('Sami Abi Nader'), 'SN')
})
test('initialsOf: ignores a role suffix', () => {
  assert.equal(initialsOf('Rami Saad (Agent)'), 'RS')
  assert.equal(initialsOf('Maya Mansour (Manager)'), 'MM')
})
test('initialsOf: single name and empty input', () => {
  assert.equal(initialsOf('Cher'), 'CH')
  assert.equal(initialsOf('', 'a7'), 'A7')
  assert.equal(initialsOf('   ', 'a7'), 'A7')
})
test('displayName: strips a trailing role label', () => {
  assert.equal(displayName('Rami Saad (Agent)'), 'Rami Saad')
  assert.equal(displayName('Rami Saad'), 'Rami Saad')
})
test('colorFor: stable across calls, varies by id', () => {
  assert.equal(colorFor('a2'), colorFor('a2'))
  assert.notEqual(colorFor('a1'), colorFor('a2'))
})

// ── Building the roster ─────────────────────────────────────────────────────
test('includes agents that have a profile', () => {
  const r = buildRoster([{ agent_code: 'a2', Full_name: 'Rami Saad (Agent)' }], [], KNOWN)
  assert.equal(r.length, 1)
  assert.equal(r[0].id, 'a2')
  assert.equal(r[0].name, 'Rami Saad')
})
test('includes agent codes that only appear on deals', () => {
  // The bug this guards: an agent with deals but no profile row was absent from
  // the filter entirely, so a manager could not isolate their pipeline.
  const r = buildRoster([], ['a3', 'a3', 'a4'], KNOWN)
  assert.deepEqual(r.map(a => a.id).sort(), ['a3', 'a4'])
})
test('profiles and deal codes are merged without duplicates', () => {
  const r = buildRoster(
    [{ agent_code: 'a2', Full_name: 'Rami Saad (Agent)' }],
    ['a2', 'a2', 'a3'],
    KNOWN,
  )
  assert.deepEqual(r.map(a => a.id).sort(), ['a2', 'a3'])
})
test('a code with no profile is flagged, not silently renamed', () => {
  const r = buildRoster([], ['zz9'], KNOWN)
  assert.equal(r[0].orphan, true)
  assert.equal(r[0].name, 'zz9')
})
test('a known id keeps its shipped colour and initials', () => {
  const r = buildRoster([{ agent_code: 'a1', Full_name: 'Lara Khoury' }], [], KNOWN)
  assert.equal(r[0].color, '#5E8FD6')
  assert.equal(r[0].initials, 'LK')
})
test('an unknown id gets usable initials and a palette colour', () => {
  const r = buildRoster([{ agent_code: 'a9', Full_name: 'New Person' }], [], KNOWN)
  assert.equal(r[0].initials, 'NP')
  assert.ok(r[0].color.startsWith('#'))
})
test('no two agents in a roster share a colour', () => {
  // a9 hashes to the same palette slot as a1, so this would collide without
  // in-roster resolution — and colour is how an agent is identified on a card.
  const r = buildRoster([
    { agent_code: 'a1', Full_name: 'Lara Khoury' },
    { agent_code: 'a2', Full_name: 'Rami Saad' },
    { agent_code: 'a9', Full_name: 'New Person' },
    { agent_code: 'zz9', Full_name: 'Another Person' },
  ], [], KNOWN)
  const colors = r.map(a => a.color)
  assert.equal(new Set(colors).size, colors.length, `colours collided: ${colors.join(', ')}`)
})
test('agents the app ships colours for keep them', () => {
  const r = buildRoster([
    { agent_code: 'a1', Full_name: 'Lara Khoury' },
    { agent_code: 'a9', Full_name: 'New Person' },
  ], [], KNOWN)
  assert.equal(r.find(a => a.id === 'a1').color, '#5E8FD6')
})
test('colour assignment is stable across identical builds', () => {
  const input = [
    { agent_code: 'a9', Full_name: 'New Person' },
    { agent_code: 'zz9', Full_name: 'Another Person' },
  ]
  assert.deepEqual(
    buildRoster(input, [], KNOWN).map(a => a.color),
    buildRoster(input, [], KNOWN).map(a => a.color),
  )
})
test('profiles without an agent_code are ignored (managers)', () => {
  const r = buildRoster([{ agent_code: null, Full_name: 'Maya Mansour (Manager)' }], [], KNOWN)
  assert.deepEqual(r, [])
})
test('sorted by name so the dropdown order is stable', () => {
  const r = buildRoster([
    { agent_code: 'a3', Full_name: 'Sami Abi Nader' },
    { agent_code: 'a1', Full_name: 'Lara Khoury' },
    { agent_code: 'a2', Full_name: 'Rami Saad' },
  ], [], KNOWN)
  assert.deepEqual(r.map(a => a.name), ['Lara Khoury', 'Rami Saad', 'Sami Abi Nader'])
})
test('null and undefined deal agent ids are skipped', () => {
  const r = buildRoster([], [null, undefined, 'a1'], KNOWN)
  assert.deepEqual(r.map(a => a.id), ['a1'])
})

// ── Lookup ──────────────────────────────────────────────────────────────────
test('findAgent returns null for an unknown id, never the first agent', () => {
  // The bug this guards: falling back to AGENTS[0] displayed one agent's deals
  // under another agent's name and colour.
  const roster = buildRoster([{ agent_code: 'a1', Full_name: 'Lara Khoury' }], [], KNOWN)
  assert.equal(findAgent(roster, 'a4'), null)
  assert.equal(findAgent(roster, null), null)
  assert.equal(findAgent(roster, 'a1').name, 'Lara Khoury')
})
test('unknownAgent is visibly unattributed', () => {
  assert.match(unknownAgent('a9').name, /Unassigned/)
  assert.equal(unknownAgent(null).name, 'Unassigned')
  assert.equal(unknownAgent('a9').initials, '—')
})
