// Unit tests for finding existing listings (listing-search-core.ts). Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchTerms, phoneQuery, phoneRegex, rankCandidates, hitLine, describeQuery, hasCriteria } from './listing-search-core.ts'

const row = (id, title, area, ex = {}, extra = {}) => ({
  id, Title: title, Location: area, Neighborhood: null, Price: 300000, Bedrooms: 3, Status: 'Available',
  Amenities: JSON.stringify({ agentId: 'a1', transaction: 'For Sale', type: 'Appartement', ...ex }), ...extra,
})
const everyone = () => true
const onlyOwn = code => (_r, ex) => ex.agentId === code

test('searchTerms: keeps what identifies the listing, drops request words', () => {
  assert.deepEqual(searchTerms('edit the property of Georges Khoury'), ['georges', 'khoury'])
  assert.deepEqual(searchTerms('find listing owned by Haddad in Kaslik'), ['haddad', 'kaslik'])
  // Filter syntax characters can't reach the database query.
  assert.deepEqual(searchTerms('khoury,(x)*%"'), ['khoury'])
})

test('phoneQuery / phoneRegex: any format of a Lebanese number', () => {
  assert.equal(phoneQuery('owner 03 123 456'), '3123456')
  assert.equal(phoneQuery('+961 70 123 456'), '70123456')
  assert.equal(phoneQuery('khoury'), null)
  assert.ok(new RegExp(phoneRegex('70123456')).test('{"ownerContact":"70-123-456"}'))
  assert.ok(new RegExp(phoneRegex('70123456')).test('{"ownerContact":"+961 70 123456"}'))
})

test('rankCandidates: finds a listing by its owner\'s name', () => {
  const rows = [
    row(10, '3 bed apartment', 'Kaslik', { ownerName: 'Georges Khoury' }),
    row(11, 'Villa with pool', 'Broummana', { ownerName: 'Rita Haddad' }),
  ]
  const hits = rankCandidates(rows, { text: 'property of khoury' }, everyone)
  assert.deepEqual(hits.map(h => h.id), [10])
  assert.equal(hits[0].ownerName, 'Georges Khoury')
})

test('rankCandidates: every word must match somewhere', () => {
  const rows = [
    row(10, '3 bed apartment', 'Kaslik', { ownerName: 'Georges Khoury' }),
    row(12, 'Office', 'Hamra', { ownerName: 'Georges Nassar' }),
  ]
  assert.deepEqual(rankCandidates(rows, { text: 'georges kaslik' }, everyone).map(h => h.id), [10])
  assert.deepEqual(rankCandidates(rows, { text: 'georges' }, everyone).map(h => h.id).sort(), [10, 12])
})

test('rankCandidates: another agent\'s owner is never searchable (privacy)', () => {
  const rows = [row(10, '3 bed apartment', 'Kaslik', { agentId: 'a2', ownerName: 'Georges Khoury', ownerContact: '03 123 456' })]
  assert.deepEqual(rankCandidates(rows, { text: 'khoury' }, onlyOwn('a1')), [])
  assert.deepEqual(rankCandidates(rows, { text: '03123456' }, onlyOwn('a1')), [])
  // …but the same agent (or a manager) finds it, and a public word still works for anyone.
  assert.equal(rankCandidates(rows, { text: 'khoury' }, onlyOwn('a2')).length, 1)
  const pub = rankCandidates(rows, { text: 'kaslik' }, onlyOwn('a1'))
  assert.equal(pub.length, 1)
  assert.equal(pub[0].ownerName, undefined)            // owner not shown to them
})

test('rankCandidates: by owner phone in any format', () => {
  const rows = [
    row(10, 'Flat', 'Jounieh', { ownerContact: '70-123-456' }),
    row(11, 'Flat', 'Jounieh', { ownerContact: '71 999 888' }),
  ]
  assert.deepEqual(rankCandidates(rows, { text: '+961 70 123456' }, everyone).map(h => h.id), [10])
})

test('rankCandidates: owner match outranks an area match; newer breaks ties', () => {
  const rows = [
    row(20, 'Shop', 'Khoury Street', {}),
    row(21, 'Villa', 'Adma', { ownerName: 'Khoury' }),
    row(22, 'Flat', 'Adma', { ownerName: 'Khoury' }),
  ]
  assert.deepEqual(rankCandidates(rows, { text: 'khoury' }, everyone).map(h => h.id), [22, 21, 20])
})

test('hitLine / describeQuery / hasCriteria', () => {
  const [h] = rankCandidates([row(10, '3 bed apartment', 'Kaslik', { ownerName: 'Georges Khoury' }, { Status: 'Sold' })], { text: 'khoury' }, everyone)
  assert.equal(hitLine(h), '#10 3 bed apartment · Kaslik · $300,000 · Sold · owner Georges Khoury')
  assert.equal(describeQuery({ text: 'khoury', location: 'Kaslik' }), '"khoury" in Kaslik')
  assert.equal(hasCriteria({ text: 'the property' }), false)
  assert.equal(hasCriteria({ text: 'khoury' }), true)
})

test('searchTerms: a listing-type word still searches (villa → type)', () => {
  const rows = [
    { id: 1, Title: 'Sea view home', Location: 'Kaslik', Amenities: JSON.stringify({ type: 'Villa' }) },
    { id: 2, Title: 'Flat', Location: 'Kaslik', Amenities: JSON.stringify({ type: 'Appartement' }) },
  ]
  assert.deepEqual(rankCandidates(rows, { text: 'villa in kaslik' }, () => true).map(h => h.id), [1])
})
