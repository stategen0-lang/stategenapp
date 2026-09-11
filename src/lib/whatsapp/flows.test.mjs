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
  renderForm, parseForm, missingMandatory, firstMissing, nextQuestion,
  CLIENT_TEMPLATE, looksLikeForm, isClientForm, isTemplateRequest,
} from './flows.ts'

// ── conversational prompts ────────────────────────────────────────────────
test('firstMissing: returns the first empty mandatory step, null when complete', () => {
  assert.equal(firstMissing({}, CREATE_PROPERTY_STEPS).key, 'type')
  assert.equal(firstMissing({ type: 'Villa' }, CREATE_PROPERTY_STEPS).key, 'transaction')
  const full = { type: 'Villa', transaction: 'For Sale', location: 'Beirut', neighborhood: 'Hamra', price: 500000, ownerName: 'Joe', ownerContact: '03 1' }
  assert.equal(firstMissing(full, CREATE_PROPERTY_STEPS), null)
})

test('nextQuestion: asks a natural question, prefixes the ack', () => {
  const q = nextQuestion({}, CREATE_CLIENT_STEPS)
  assert.match(q, /name/i)
  assert.equal(q.includes('Copy this'), false)   // not the old form
  const acked = nextQuestion({}, CREATE_CLIENT_STEPS, 'Got it.')
  assert.match(acked, /^Got it\./)
})

test('nextQuestion: empty when nothing mandatory is missing', () => {
  const full = { name: 'Joe', phone: '03 1', clientType: 'Buyer', propertyType: 'Appartement', location: 'Metn', budget: 500000 }
  assert.equal(nextQuestion(full, CREATE_CLIENT_STEPS), '')
})

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

test('coerceType: the new listing types are recognised, even inside a phrase', () => {
  // These used to be synonyms of other types; they are now types in their own
  // right and must map to themselves, not be rewritten.
  assert.equal(coerceType('studio'), 'Studio')
  assert.equal(coerceType('duplex'), 'Duplex')
  assert.equal(coerceType('showroom'), 'Showroom')
  assert.equal(coerceType('chalet'), 'Chalet')
  assert.equal(coerceType('standalone'), 'Standalone')
  assert.equal(coerceType('garage'), 'Garage')
  assert.equal(coerceType('warehouse'), 'Warehouse')
  assert.equal(coerceType('duplex in Achrafieh'), 'Duplex')
  assert.equal(coerceType('nice studio near Hamra'), 'Studio')
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
    'Area (required): Achrafieh', 'Price (required): 450k',
    'Bedrooms (optional): 3', 'Bathrooms (optional): 2', 'Size (optional): 180',
    'Parking spaces (optional): 1', 'Owner name (required): Mr Khoury', 'Owner phone (required): 03111222',
  ].join('\n'))
  assert.deepEqual(invalid, [])
  assert.equal(context.type, 'Appartement')
  assert.equal(context.transaction, 'For Sale')
  assert.equal(context.location, 'Achrafieh')
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
test('seedContext: collapses split neighbourhood/city into one area (prefers neighbourhood)', () => {
  assert.equal(seedContext({ neighborhood: 'Hamra', location: 'Beirut' }).location, 'Hamra')
  assert.equal(seedContext({ district: 'Achrafieh', city: 'Beirut' }).location, 'Achrafieh')
  assert.equal(seedContext({ city: 'Jounieh' }).location, 'Jounieh')
  assert.equal('neighborhood' in seedContext({ neighborhood: 'Hamra', location: 'Beirut' }), false)
})
// ── Real client briefs from the agency (Arabizi + multi-area + ranges) ───────
// These assert the mapping layer: given what the extractor pulls out of a real
// WhatsApp brief, the flow must keep every field instead of dropping it.
test('seedContext (client): a multi-area brief fills locations AND the asked location', () => {
  const ctx = seedContext({
    name: 'Dana Tohme', clientType: 'renter', propertyType: 'apartment',
    locations: ['Zakrit', 'Zouk', 'Kaslik', 'Aintoura'],
    furnishing: 'Unfurnished', beds: 2, baths: 2,
    notes: 'She and her 13-year-old son.',
  }, CREATE_CLIENT_STEPS)
  assert.deepEqual(ctx.locations, ['Zakrit', 'Zouk', 'Kaslik', 'Aintoura'])
  // The mandatory single "location" is derived, so the bot doesn't re-ask.
  assert.equal(ctx.location, 'Zakrit, Zouk, Kaslik, Aintoura')
  assert.equal(ctx.furnishing, 'Unfurnished')
  assert.equal(ctx.beds, 2)
  assert.equal(ctx.notes, 'She and her 13-year-old son.')
  assert.equal(missingMandatory(ctx, CREATE_CLIENT_STEPS).map(s => s.key).includes('location'), false)
})

test('seedContext (client): budget range, sqm, advance payment, sea view', () => {
  const ctx = seedContext({
    name: 'Manale Laadam', clientType: 'renter', propertyType: 'apartment',
    locations: ['Jounieh', 'Ghazir'], budget: '450$ -400$', size: 'at least 50',
    view: 'Sea', balcony: true, advancedPayment: true, floor: 'No GF',
  }, CREATE_CLIENT_STEPS)
  assert.equal(ctx.budget, 450)          // range -> the top end
  assert.equal(ctx.size, 50)
  assert.equal(ctx.view, 'Sea')
  assert.equal(ctx.balcony, true)
  assert.equal(ctx.advancedPayment, true)
  // "No GF" is an exclusion, not a floor preference — it must not become one.
  assert.equal(ctx.floor, undefined)
})

test('seedContext (client): a shop brief keeps the single area and size', () => {
  const ctx = seedContext({
    name: 'Pascale Bou Chaaya', phone: '+961 76 099 942', clientType: 'renter',
    propertyType: 'shop', locations: ['Zouk Mikael'], budget: 'up to 600$', size: 50,
  }, CREATE_CLIENT_STEPS)
  assert.equal(ctx.propertyType, 'Shop')
  assert.equal(ctx.budget, 600)
  assert.equal(ctx.location, 'Zouk Mikael')
  assert.deepEqual(missingMandatory(ctx, CREATE_CLIENT_STEPS), [])   // nothing left to ask
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

test('client form: lists the client fields with tags (no email)', () => {
  const form = clientForm()
  assert.match(form, /Adding a client/)
  for (const label of ['Name', 'Phone', 'Buyer or renter', 'Looking for', 'Preferred area', 'Budget', 'Bedrooms', 'Bathrooms', 'Parking spaces']) {
    assert.ok(form.includes(`${label} (`), `client form missing "${label}"`)
  }
  assert.match(form, /Name \(required/)
  assert.match(form, /Bathrooms \(optional/)
  assert.match(form, /Parking spaces \(optional/)
  assert.equal(/Email/.test(form), false)            // email was dropped
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
    'Bathrooms (optional): 2',
    'Parking spaces (optional): 1',
  ].join('\n'))
  assert.deepEqual(invalid, [])
  assert.equal(context.name, 'Ahmed Khoury')
  assert.equal(context.clientType, 'Buyer')          // "buyer" → Buyer
  assert.equal(context.propertyType, 'Appartement')  // "apartment" → Appartement
  assert.equal(context.location, 'Achrafieh')
  assert.equal(context.budget, 400000)
  assert.equal(context.beds, 3)
  assert.equal(context.baths, 2)
  assert.equal(context.parkings, 1)
})
test('parseForm (client): "renter"/"tenant" become Renter', () => {
  assert.equal(parseClient('Buyer or renter (required): renter').context.clientType, 'Renter')
  assert.equal(parseClient('Buyer or renter (required): tenant looking to lease').context.clientType, 'Renter')
})
test('missingMandatory (client): required only', () => {
  const missing = missingClient({ name: 'Ahmed' }).map(s => s.key)
  assert.ok(missing.includes('phone') && missing.includes('budget') && missing.includes('propertyType'))
  assert.equal(missing.includes('beds'), false)      // bed/bath/parking are optional
  assert.deepEqual(missingClient(fullClient), [])
})
test('seedForm (client): maps an opening message\'s fields', () => {
  const ctx = seedForm({ name: 'Ahmed', clientType: 'buyer', propertyType: 'villa', location: 'Hamra', budget: 600000, phone: '03111222' }, CREATE_CLIENT_STEPS)
  assert.equal(ctx.name, 'Ahmed')
  assert.equal(ctx.clientType, 'Buyer')
  assert.equal(ctx.propertyType, 'Villa')
  assert.equal(ctx.budget, 600000)
})
test('seedForm (client): a full forwarded enquiry leaves nothing mandatory missing', () => {
  // Fields as the classifier extracts them from a forwarded client message —
  // seeding must fill every required field so the bot skips to confirm.
  const ctx = seedForm(
    { name: 'Joe Khoury', clientType: 'buyer', propertyType: 'apartment', location: 'Achrafieh', budget: 250000, beds: 2, phone: '03 123456' },
    CREATE_CLIENT_STEPS,
  )
  assert.equal(ctx.propertyType, 'Appartement')   // "apartment" → canonical spelling
  assert.equal(ctx.clientType, 'Buyer')
  assert.equal(ctx.beds, 2)
  assert.deepEqual(missingClient(ctx), [])
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

// ── The client brief template agents are given ───────────────────────────────
// This is the copy-paste form the agency hands to its agents, so a filled-in
// copy must be read exactly — no model call is involved on this path.

test('CLIENT_TEMPLATE: a blank copy parses to nothing (no hint read as a value)', () => {
  const { context, invalid } = parseClient(CLIENT_TEMPLATE)
  assert.deepEqual(context, {})
  assert.deepEqual(invalid, [])
  assert.equal(looksLikeForm(CLIENT_TEMPLATE, CREATE_CLIENT_STEPS), false)
})

test('CLIENT_TEMPLATE: every line maps to a field when filled in', () => {
  const filled = [
    '📋 New client — copy this, fill in what you know, send it back.',
    '1- Name: Dana Tohme',
    '2- Phone: 03 111 222',
    '3- Buying or renting: renting',
    '4- Looking for: apartment',
    '5- Areas: Zouk, Kaslik, Aintoura',
    '6- Budget (USD): 400$ - 450$',
    '7- Bedrooms: 2',
    '8- Bathrooms: 2',
    '9- Size (m2): at least 50',
    '10- Furnished: unfurnished',
    '11- View: sea',
    '12- Floor: mid',
    '13- Balcony: yes',
    '14- Parking: 1',
    '15- Advance payment: yes',
    '16- Notes: not close to the beach',
  ].join('\n')
  const { context, invalid } = parseClient(filled)
  assert.deepEqual(invalid, [])
  assert.equal(context.name, 'Dana Tohme')
  assert.equal(context.phone, '03 111 222')
  assert.equal(context.clientType, 'Renter')
  assert.equal(context.propertyType, 'Appartement')
  assert.deepEqual(context.locations, ['Zouk', 'Kaslik', 'Aintoura'])
  assert.equal(context.location, 'Zouk, Kaslik, Aintoura')   // derived, never asked
  assert.equal(context.budget, 450)                          // range → the top end
  assert.equal(context.beds, 2)
  assert.equal(context.baths, 2)
  assert.equal(context.size, 50)
  assert.equal(context.furnishing, 'Unfurnished')
  assert.equal(context.view, 'sea')
  assert.equal(context.floor, 'Mid floor')
  assert.equal(context.balcony, true)
  assert.equal(context.parkings, 1)
  assert.equal(context.advancedPayment, true)
  assert.equal(context.notes, 'not close to the beach')
  assert.deepEqual(missingClient(context), [])               // nothing left to ask
})

test('CLIENT_TEMPLATE: a half-filled copy keeps what is there and asks for the rest', () => {
  const { context } = parseClient([
    '1- Name: Pascale Bou Chaaya',
    '2- Phone: +961 76 099 942',
    '3- Buying or renting: rent',
    '4- Looking for: store',
    '5- Areas: Zouk Mikael',
    '6- Budget (USD):',
    '9- Size (m2): 50',
  ].join('\n'))
  assert.equal(context.propertyType, 'Shop')                 // "store" → Shop
  assert.equal(context.size, 50)
  assert.deepEqual(missingClient(context).map(s => s.key), ['budget'])
})

test('parseForm (client): the agency\'s own numbered brief still reads', () => {
  // Sent verbatim by the company before this template existed.
  const { context } = parseClient([
    '1-Name of client : woman',
    '2-Request sale or rent : rent',
    '3-Areas interests: Batroun',
    '4-Budget range: 1250',
    '5-Comment keep in mind : not close to the beach',
  ].join('\n'))
  assert.equal(context.name, 'woman')
  assert.equal(context.clientType, 'Renter')
  assert.deepEqual(context.locations, ['Batroun'])
  assert.equal(context.budget, 1250)
  assert.equal(context.notes, 'not close to the beach')
})

test('isClientForm: a filled client form, not prose and not a listing form', () => {
  assert.equal(isClientForm('1- Name: Dana\n2- Phone: 03111222\n3- Buying or renting: rent'), true)
  assert.equal(isClientForm('info on Ahmed: what is his budget?'), false)
  assert.equal(isClientForm('spoke to Dana: she wants Zouk'), false)
  assert.equal(isClientForm(''), false)
  assert.equal(isClientForm(null), false)
  // A filled LISTING form shares Bedrooms/Size/Area, so it must not be claimed.
  assert.equal(isClientForm([
    'Type: villa', 'Sale or rent: sale', 'Area: Achrafieh',
    'Price: 450k', 'Bedrooms: 3', 'Owner name: Joe', 'Owner phone: 03 111222',
  ].join('\n')), false)
})

test('isTemplateRequest: asks for the form, and only that', () => {
  for (const s of ['template', 'Template', 'form', 'client template', 'send me the template', 'template for a new client']) {
    assert.equal(isTemplateRequest(s), true, `should ask for the template: ${s}`)
  }
  for (const s of ['add a client', 'what template did you send', '', 'Name: Dana\nPhone: 03111222']) {
    assert.equal(isTemplateRequest(s), false, `should not: ${s}`)
  }
})

test('seedForm (client): derives the single area from a multi-area brief', () => {
  // The client flow seeds through seedForm, not seedContext — the derivation has
  // to live on this path too or the bot re-asks "which area?" for every brief.
  const ctx = seedForm({ locations: ['Zouk', 'Kaslik'], name: 'Dana' }, CREATE_CLIENT_STEPS)
  assert.deepEqual(ctx.locations, ['Zouk', 'Kaslik'])
  assert.equal(ctx.location, 'Zouk, Kaslik')
})
