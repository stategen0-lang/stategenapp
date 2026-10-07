// node --experimental-strip-types --import ./scripts/test-setup.mjs --test src/lib/alerts-client-direction.test.mjs
//
// An agent adds a CLIENT, and the agents whose listings fit are told. This is
// the only alert in the system aimed at somebody other than the client's own
// agent, which is what makes it worth pinning down: who gets it, who does not,
// and that it is filed against the right listing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './whatsapp/fake-db.mjs'
import { createClientAlerts } from './alerts-server.ts'

const COMPANY = 1

/** A client that wants a 3-bed apartment in Achrafieh at $500,000. */
const clientRow = (agentId, o = {}) => ({
  id: o.id ?? 10,
  company_id: COMPANY,
  'Client Name': o.name ?? 'Ahmed Khoury',
  'client phone': '03 111 222',
  budget_max: o.budget ?? 500000,
  bedrooms: 3,
  'prefered-location': o.location ?? 'Achrafieh',
  payment_terms: 'For Sale',
  status: 'Searching',
  notes: JSON.stringify({
    agentId,
    req: { type: 'Apartment', location: o.location ?? 'Achrafieh', locations: [o.location ?? 'Achrafieh'], beds: 3 },
  }),
})

const listing = (id, agentId, o = {}) => ({
  id, company_id: COMPANY,
  Title: o.title ?? `Listing ${id}`,
  Price: o.price ?? 500000,
  Status: o.status ?? 'Available',
  Location: o.city ?? 'Achrafieh',
  Neighborhood: '',
  Bedrooms: 3, bathrooms: 2, size: 150,
  Amenities: JSON.stringify({ agentId, type: 'Apartment', transaction: 'For Sale' }),
})

const seed = (listings) => fakeDb({
  Properties: listings,
  listing_alerts: [],
  push_subscriptions: [],
  company_areas: [],
})

test('the agents whose listings fit are alerted, and the client\'s own agent is not', async () => {
  const db = seed([
    listing(1, 'SM-2'),                                   // another agent — should be told
    listing(2, 'NH-1'),                                   // the client's OWN agent — should not
    listing(3, 'DH-3', { city: 'Tripoli' }),              // too far — no match at all
  ])
  const written = await createClientAlerts(db.client, COMPANY, clientRow('NH-1'))
  assert.equal(written, 1)

  const alerts = db.table('listing_alerts')
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].property_id, 1)
  assert.equal(alerts[0].client_id, 10)
  // Aimed at the LISTING's agent — the thing that makes this alert different.
  assert.equal(alerts[0].agent_code, 'SM-2')
  assert.equal(alerts[0].reason, 'new_client')
  assert.ok(alerts[0].score >= 60)
})

test('a client with nothing on file alerts nobody', async () => {
  // The same brief rule the matcher uses: no budget, no area, no type means
  // they would otherwise match every listing in the agency at 100%.
  const db = seed([listing(1, 'SM-2')])
  const blank = {
    id: 11, company_id: COMPANY, 'Client Name': 'Walk-in', budget_max: 0,
    'prefered-location': null, bedrooms: 0, payment_terms: null,
    notes: JSON.stringify({ agentId: 'NH-1', req: {} }),
  }
  assert.equal(await createClientAlerts(db.client, COMPANY, blank), 0)
  assert.equal(db.table('listing_alerts').length, 0)
})

test('listings that are spoken for are not offered', async () => {
  const db = seed([
    listing(1, 'SM-2', { status: 'Sold' }),
    listing(2, 'SM-2', { status: 'Rented' }),
    listing(3, 'SM-2', { status: 'Reserved' }),
  ])
  assert.equal(await createClientAlerts(db.client, COMPANY, clientRow('NH-1')), 0)
})

test('one agent with several matching listings is alerted about each', async () => {
  // The in-app feed carries every match; only the phone notification is
  // collapsed to the best one.
  const db = seed([listing(1, 'SM-2'), listing(2, 'SM-2'), listing(3, 'SM-2')])
  assert.equal(await createClientAlerts(db.client, COMPANY, clientRow('NH-1')), 3)
  assert.deepEqual(db.table('listing_alerts').map(a => a.agent_code), ['SM-2', 'SM-2', 'SM-2'])
})

// No "a listing nobody owns" case: dbRowToProperty falls an absent agentId back
// to a placeholder, so a listing without one cannot reach this code un-owned.
// The filter that skips the client's own agent is covered by the first test.

test('adding the same client twice does not alert twice', async () => {
  const db = seed([listing(1, 'SM-2')])
  await createClientAlerts(db.client, COMPANY, clientRow('NH-1'))
  await createClientAlerts(db.client, COMPANY, clientRow('NH-1'))
  // One row per (listing, client) — the same guard every other alert uses.
  assert.equal(db.table('listing_alerts').length, 1)
})
