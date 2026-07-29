// Unit tests for the listing + client forms (src/lib/whatsapp/flows.ts).
// Both flows share one form engine, so the tests exercise it against each field
// set: building the form, parsing a filled one, and knowing what's required.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CREATE_PROPERTY_STEPS, CREATE_CLIENT_STEPS, LISTING_INTRO, CLIENT_INTRO,
  seedContext, seedForm, derivedTitle, isStartListing, isStartClient,
  coerceType, extrasOf, answersOf, EXTRA_KEY,
  renderForm, parseForm, missingMandatory,
} from './flows.ts'

const propForm = (ctx = {}) => renderForm(LISTING_INTRO, CREATE_PROPERTY_STEPS, ctx)
const parseProp = (t, base) => parseForm(t, CREATE_PROPERTY_STEPS, base)
const missingProp = (ctx) => missingMandatory(ctx, CREATE_PROPERTY_STEPS)

const fullProp = {
  type: 'Appartement', transaction: 'For Sale', location: 'Beirut',
  neighborhood: 'Hamra', price: 450000, ownerName: 'Mr Khoury', ownerContact: '03111222',
}

// ── coerceType ──────────────────────────────────────────────────────────────
test('coerceType: English spellings, common words, canonical, nonsense', () => {
  assert.equal(coerceType('Apartment'), 'Appartement')
  assert.equal(coerceType('flat'), 'Appartement')
  assert.equal(coerceType('house'), 'Villa')
  assert.equal(coerceType('villa'), 'Villa')
  assert.equal(coerceType('spaceship'), null)
})

// ── The listing form ────────────────────────────────────────────────────────
test('renderForm: lists every field with a required/optional tag', () => {
  const form = propForm()
  for (const s of CREATE_PROPERTY_STEPS) assert.ok(form.includes(`${s.label} (`), `missing "${s.label}"`)
  assert.match(form, /Type \(required/)
  assert.match(form, /Bathrooms \(optional/)
  assert.match(form, /Parking spaces \(optional/)
})
test('renderForm: pre-fills known values, keeps hints out of the value slot', () => {
  const form = propForm({ type: 'Villa', price: 450000 })
  assert.match(form, /Type \(required\): Villa/)
  assert.match(form, /Price \(required\): 450000/)
  const fieldLines = form.split('\n').filter(l => /\((required|optional)/.test(l))
  assert.equal(fieldLines.length, CREATE_PROPERTY_STEPS.length)
})
test('renderForm: an unfilled optional line has an empty value (hint in the label)', () => {
  for (const line of propForm().split('\n').filter(l => /\((required|optional)/.test(l))) {
    assert.equal(line.slice(line.indexOf(':') + 1).trim(), '', `hint leaked after colon: "${line}"`)
  }
})

// ── Parsing a filled listing form ───────────────────────────────────────────
test('parseForm (listing): reads every labelled line', () => {
  const { context, invalid } = parseProp([
    'Type (required): Apartment', 'Sale or rent (required): sale',
    'City (required): Beirut', 'Area (required): Hamra', 'Price (required): 450k',
    'Bedrooms (optional): 3', 'Bathrooms (optional): 2', 'Size (optional): 180',
    'Parking spaces (optional): 1', 'Owner name (required): Mr Khoury', 'Owner phone (required): 03111222',
  ].join('\n'))
  assert.deepEqual(invalid, [])
  assert.equal(context.type, 'Appartement')
  assert.equal(context.transaction, 'For Sale')
  assert.equal(context.price, 450000)
  assert.equal(context.baths, 2)
  assert.equal(context.size, 180)
  assert.equal(context.parkings, 1)
  assert.equal(context.ownerContact, '03111222')
})
test('parseForm: blank optional is skipped, bad value is reported', () => {
  const { context, invalid } = parseProp('Bedrooms (optional):\nPrice (required): free')
  assert.equal('beds' in context, false)
  assert.ok(invalid.includes('Price'))
})
test('parseForm: tolerates the agent\'s own labels (aliases)', () => {
  const { context } = parseProp('sqm: 200\nparking: 2\nbeds: 4\nowner number: 03999')
  assert.equal(context.size, 200)
  assert.equal(context.parkings, 2)
  assert.equal(context.beds, 4)
  assert.equal(context.ownerContact, '03999')
})
test('parseForm: merges onto an existing context; ignores junk lines', () => {
  const { context, invalid } = parseProp('Price (required): 500k\nhello there', { type: 'Villa' })
  assert.equal(context.type, 'Villa')
  assert.equal(context.price, 500000)
  assert.deepEqual(invalid, [])
})
test('a filled listing form round-trips', () => {
  const parsed = parseProp(propForm({ type: 'Villa', location: 'Beirut' })).context
  assert.equal(parsed.type, 'Villa')
  assert.equal(parsed.location, 'Beirut')
})

// ── missingMandatory ────────────────────────────────────────────────────────
test('missingMandatory (listing): required only, empty when complete', () => {
  const missing = missingProp({ type: 'Villa' }).map(s => s.key)
  assert.ok(missing.includes('price') && missing.includes('ownerName'))
  assert.equal(missing.includes('type'), false)
  assert.equal(missing.includes('beds'), false)        // optional never blocks
  assert.deepEqual(missingProp(fullProp), [])
})

// ── Seeding from the opening message ────────────────────────────────────────
test('seedContext (listing): form fields land in context, extras elsewhere', () => {
  const ctx = seedContext({ beds: 3, baths: 2, size: 140, parkings: 1, rent: 1200 })
  assert.equal(ctx.baths, 2)
  assert.equal(ctx.size, 140)
  assert.deepEqual(extrasOf(ctx), { rent: 1200 })
})
test('seedContext: drops junk, ignores unknown keys, empty ok', () => {
  const ctx = seedContext({ price: 'negotiable', type: 'Spaceship', company_id: 99 })
  assert.equal(ctx.price, undefined)
  assert.equal('company_id' in ctx, false)
  assert.deepEqual(seedContext(undefined), {})
  assert.equal(EXTRA_KEY in seedContext({ beds: 3 }), false)
  assert.deepEqual(answersOf({ beds: 3 }), { beds: 3 })
})

// ── The client form ─────────────────────────────────────────────────────────
const clientForm = (ctx = {}) => renderForm(CLIENT_INTRO, CREATE_CLIENT_STEPS, ctx)
const parseClient = (t, base) => parseForm(t, CREATE_CLIENT_STEPS, base)
const missingClient = (ctx) => missingMandatory(ctx, CREATE_CLIENT_STEPS)

const fullClient = {
  name: 'Ahmed Khoury', phone: '03111222', clientType: 'Buyer',
  propertyType: 'Appartement', location: 'Achrafieh', budget: 400000,
}

test('client form: lists the client fields with tags', () => {
  const form = clientForm()
  assert.match(form, /Adding a client/)
  for (const label of ['Name', 'Phone', 'Buyer or renter', 'Looking for', 'Preferred area', 'Budget', 'Bedrooms', 'Email']) {
    assert.ok(form.includes(`${label} (`), `client form missing "${label}"`)
  }
  assert.match(form, /Name \(required/)
  assert.match(form, /Email \(optional/)
})
test('parseForm (client): reads and coerces the fields', () => {
  const { context, invalid } = parseClient([
    'Name (required): Ahmed Khoury',
    'Phone (required): 03111222',
    'Buyer or renter (required): buyer',
    'Looking for (required): apartment',
    'Preferred area (required): Achrafieh',
    'Budget (required): 400k',
    'Bedrooms (optional): 3',
    'Email (optional): a@x.com',
  ].join('\n'))
  assert.deepEqual(invalid, [])
  assert.equal(context.name, 'Ahmed Khoury')
  assert.equal(context.clientType, 'Buyer')          // "buyer" → Buyer
  assert.equal(context.propertyType, 'Appartement')  // "apartment" → Appartement
  assert.equal(context.location, 'Achrafieh')
  assert.equal(context.budget, 400000)
  assert.equal(context.beds, 3)
  assert.equal(context.email, 'a@x.com')
})
test('parseForm (client): "renter"/"tenant" become Renter', () => {
  assert.equal(parseClient('Buyer or renter (required): renter').context.clientType, 'Renter')
  assert.equal(parseClient('Buyer or renter (required): tenant looking to lease').context.clientType, 'Renter')
})
test('missingMandatory (client): required only', () => {
  const missing = missingClient({ name: 'Ahmed' }).map(s => s.key)
  assert.ok(missing.includes('phone') && missing.includes('budget') && missing.includes('propertyType'))
  assert.equal(missing.includes('email'), false)     // optional
  assert.deepEqual(missingClient(fullClient), [])
})
test('seedForm (client): maps an opening message\'s fields', () => {
  const ctx = seedForm({ name: 'Ahmed', clientType: 'buyer', propertyType: 'villa', location: 'Hamra', budget: 600000, phone: '03111222' }, CREATE_CLIENT_STEPS)
  assert.equal(ctx.name, 'Ahmed')
  assert.equal(ctx.clientType, 'Buyer')
  assert.equal(ctx.propertyType, 'Villa')
  assert.equal(ctx.budget, 600000)
})

// ── Starting each flow, and the title ───────────────────────────────────────
test('isStartListing / isStartClient recognise their own commands', () => {
  assert.ok(isStartListing('add a listing'))
  assert.ok(isStartListing('create a property'))
  assert.equal(isStartListing('add a client'), false)

  assert.ok(isStartClient('add a client'))
  assert.ok(isStartClient('new buyer Ahmed'))
  assert.ok(isStartClient('register a renter'))
  assert.equal(isStartClient('add a listing'), false)
  assert.equal(isStartClient('info on Ahmed'), false)
})
test('derivedTitle: readable listing title', () => {
  assert.equal(derivedTitle(fullProp), 'Appartement in Hamra')
  assert.equal(derivedTitle({ ...fullProp, beds: 3 }), '3 bed Appartement in Hamra')
})
