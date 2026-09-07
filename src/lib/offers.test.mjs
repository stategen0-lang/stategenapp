// Unit tests for offer/negotiation state derivation (src/lib/offers.ts).
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { negotiationState, vsAsking, negotiationLine, otherSide, money } from './offers.ts'

const round = (o) => ({ id: o.id, amount: o.amount, side: o.side, status: o.status ?? 'pending', at: o.at })

test('negotiationState: no rounds', () => {
  const s = negotiationState([])
  assert.equal(s.status, 'none')
  assert.equal(s.currentAmount, null)
  assert.equal(s.count, 0)
})

test('negotiationState: open — latest amount, turn is the other side', () => {
  const s = negotiationState([
    round({ id: '1', amount: 450000, side: 'buyer', at: '2026-08-27T10:00:00Z' }),
    round({ id: '2', amount: 480000, side: 'owner', at: '2026-08-27T11:00:00Z' }),
    round({ id: '3', amount: 465000, side: 'buyer', at: '2026-08-27T12:00:00Z' }),
  ])
  assert.equal(s.status, 'open')
  assert.equal(s.currentAmount, 465000)
  assert.equal(s.currentSide, 'buyer')
  assert.equal(s.turn, 'owner')       // buyer moved last → owner responds
  assert.equal(s.count, 3)
})

test('negotiationState: a settled round ends it, regardless of order', () => {
  const accepted = negotiationState([
    round({ id: '1', amount: 450000, side: 'buyer', at: '2026-08-27T10:00:00Z' }),
    round({ id: '2', amount: 465000, side: 'buyer', at: '2026-08-27T12:00:00Z', status: 'accepted' }),
  ])
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.currentAmount, 465000)
  assert.equal(accepted.turn, null)

  const rejected = negotiationState([round({ id: '1', amount: 400000, side: 'buyer', at: '2026-08-27T10:00:00Z', status: 'rejected' })])
  assert.equal(rejected.status, 'rejected')
})

test('otherSide flips buyer/owner', () => {
  assert.equal(otherSide('buyer'), 'owner')
  assert.equal(otherSide('owner'), 'buyer')
})

test('vsAsking: below / at / above', () => {
  assert.equal(vsAsking(465000, 480000), '3% below asking')
  assert.equal(vsAsking(480000, 480000), 'at asking')
  assert.equal(vsAsking(504000, 480000), '5% above asking')
  assert.equal(vsAsking(465000, 0), '')       // no asking → nothing
})

test('negotiationLine: open vs settled', () => {
  const open = negotiationState([
    round({ id: '1', amount: 450000, side: 'buyer', at: '2026-08-27T10:00:00Z' }),
    round({ id: '2', amount: 480000, side: 'owner', at: '2026-08-27T11:00:00Z' }),
  ])
  const line = negotiationLine(open, { asking: 480000 })
  assert.match(line, /480,000/)
  assert.match(line, /Owner's last move/)
  assert.match(line, /Buyer to respond/)

  const none = negotiationLine(negotiationState([]))
  assert.equal(none, 'No offers yet.')
})

test('money formats with separators', () => {
  assert.equal(money(1200000), '$1,200,000')
})
