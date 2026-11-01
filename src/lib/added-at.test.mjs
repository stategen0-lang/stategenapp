import test from 'node:test'
import assert from 'node:assert/strict'
import { formatAddedAt } from './added-at.ts'
import { dbRowToClient, dbRowToProperty } from './db-mappers.ts'
import { isMatchable } from './matching.ts'

test('shown in Beirut time, not UTC', () => {
  // 22:30 UTC on the 31st is already 00:30 on the 1st in Beirut (UTC+2, winter).
  assert.match(formatAddedAt('2026-10-31T22:30:00Z'), /^1 Nov 2026, 12:30 am$/i)
  // Summer time is UTC+3.
  assert.match(formatAddedAt('2026-07-15T09:05:00Z'), /^15 Jul 2026, 12:05 pm$/i)
})

test('a record with no date shows nothing rather than a wrong one', () => {
  assert.equal(formatAddedAt(undefined), '')
  assert.equal(formatAddedAt(null), '')
  assert.equal(formatAddedAt(''), '')
  assert.equal(formatAddedAt('not a date'), '')
})

test('both record types carry the date the row was created', () => {
  const at = '2026-10-01T08:00:00+00:00'
  assert.equal(dbRowToProperty({ id: 1, created_at: at, Amenities: '{}' }, 0).createdAt, at)
  assert.equal(dbRowToClient({ id: 1, created_at: at, notes: '{}' }, 0).createdAt, at)
})

test("a listing left on the database's default status 'active' is on the market", () => {
  // The WhatsApp bot added listings without a status for months; they read as
  // off the market and never matched anyone.
  const row = { id: 1, Status: 'active', Amenities: '{}' }
  assert.equal(dbRowToProperty(row, 0).status, 'Available')
  assert.equal(isMatchable(dbRowToProperty(row, 0)), true)
  assert.equal(isMatchable({ status: 'active' }), true) // callers on the raw row
  // The statuses that really mean it's gone stay gone.
  assert.equal(dbRowToProperty({ id: 2, Status: 'Sold', Amenities: '{}' }, 0).status, 'Sold')
  assert.equal(isMatchable({ status: 'Sold' }), false)
  assert.equal(isMatchable({ status: 'Rented' }), false)
})
