// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/match-detail.test.mjs
//
// The match window shows a listing and a client's request together. The client
// may be a colleague's, so what it is allowed to show is the thing to pin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMatchDetail } from './match-detail.ts'

const propertyRow = {
  id: 12, Title: 'Sea view flat', Location: 'Beirut', Neighborhood: 'Achrafieh', Price: 300000, company_id: 1,
  Amenities: JSON.stringify({
    type: 'Apartment', transaction: 'For Sale', agentId: 'a2',
    ownerName: 'Mr Owner', ownerContact: '+961 70 000 000', documentPath: 'company-1/x.pdf', notes: 'owner is difficult',
  }),
}
const clientRow = {
  id: 7, 'Client Name': 'Hadi Karam', 'client phone': '+961 71 111 111',
  notes: JSON.stringify({
    agentId: 'a1', type: 'Buyer',
    req: { notes: 'Call his wife Rima after 6pm' },
    closing: { downPayment: 50000, documents: [] },
  }),
}
const alertRow = { score: 87.6, reason: 'new' }

const agent = (code) => ({ userId: 'u', companyId: 1, role: 'agent', agentCode: code, fullName: 'x', approved: true })
const manager = { userId: 'm', companyId: 1, role: 'manager', agentCode: null, fullName: 'M', approved: true }

test("the client's own agent sees the name, phone and notes", () => {
  const d = buildMatchDetail(agent('a1'), propertyRow, clientRow, alertRow)
  assert.equal(d.client.name, 'Hadi Karam')
  assert.equal(d.client.phone, '+961 71 111 111')
  assert.match(d.client.req.notes, /Rima/)
  assert.equal(d.canOpenClient, true)
  assert.equal(d.score, 88)
})

test("a colleague's client is masked — name, phone and the note that can carry both", () => {
  const d = buildMatchDetail(agent('a2'), propertyRow, clientRow, alertRow)
  assert.equal(d.client.name, 'Client #7')
  assert.equal(d.client.phone, '')
  assert.equal(d.client.req.notes, '')
  assert.equal(d.canOpenClient, false)
})

test('a manager sees every client', () => {
  const d = buildMatchDetail(manager, propertyRow, clientRow, alertRow)
  assert.equal(d.client.name, 'Hadi Karam')
  assert.equal(d.canOpenClient, true)
})

test('closing paperwork never comes along, for anyone', () => {
  for (const s of [agent('a1'), manager]) {
    assert.equal(buildMatchDetail(s, propertyRow, clientRow, alertRow).client.closing, undefined)
  }
})

test("a listing's owner details and internal notes never come along", () => {
  const p = buildMatchDetail(agent('a1'), propertyRow, clientRow, alertRow).property
  assert.equal(p.title, 'Sea view flat')
  assert.equal(p.ownerName, undefined)
  assert.equal(p.ownerContact, undefined)
  assert.equal(p.documentPath, undefined)
  assert.equal(p.notes, undefined)
})

test('a price drop carries the old price; a new listing does not', () => {
  const drop = buildMatchDetail(manager, propertyRow, clientRow, { score: 70, reason: 'price_drop', old_price: 350000 })
  assert.equal(drop.reason, 'price_drop')
  assert.equal(drop.oldPrice, 350000)
  const fresh = buildMatchDetail(manager, propertyRow, clientRow, { score: 70, old_price: 350000 })
  assert.equal(fresh.reason, 'new')
  assert.equal(fresh.oldPrice, null)
})
