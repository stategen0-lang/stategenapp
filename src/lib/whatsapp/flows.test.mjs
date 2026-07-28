// Unit tests for the listing form (src/lib/whatsapp/flows.ts).
// The bot now asks every field at once as a fill-in form, so the tests cover
// building that form, parsing a filled one, and knowing what's still required.
// Run with:  npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CREATE_PROPERTY_STEPS, seedContext, derivedTitle, isStartListing,
  coerceType, extrasOf, answersOf, EXTRA_KEY,
  listingForm, parseListingForm, missingMandatory,
} from './flows.ts'

const full = {
  type: 'Appartement', transaction: 'For Sale', location: 'Beirut',
  neighborhood: 'Hamra', price: 450000, ownerName: 'Mr Khoury', ownerContact: '03111222',
}

// ── Property type, as people actually write it ──────────────────────────────
test('coerceType: accepts the English spelling and common words', () => {
  assert.equal(coerceType('Apartment'), 'Appartement')
  assert.equal(coerceType('flat'), 'Appartement')
  assert.equal(coerceType('house'), 'Villa')
  assert.equal(coerceType('store'), 'Shop')
  assert.equal(coerceType('a 3 bed apartment'), 'Appartement')
})
test('coerceType: keeps the canonical spellings, rejects nonsense', () => {
  for (const t of ['Appartement', 'Villa', 'Office', 'Shop', 'Land', 'Chalet', 'Building']) {
    assert.equal(coerceType(t.toLowerCase()), t)
  }
  assert.equal(coerceType('spaceship'), null)
  assert.equal(coerceType(''), null)
})

// ── The form the agent sees ─────────────────────────────────────────────────
test('listingForm: lists every field with a required/optional tag', () => {
  const form = listingForm()
  for (const s of CREATE_PROPERTY_STEPS) {
    assert.ok(form.includes(`${s.label} (`), `form is missing "${s.label}"`)
  }
  assert.match(form, /Type \(required/)
  assert.match(form, /Bedrooms \(optional/)
  assert.match(form, /Bathrooms \(optional/)
  assert.match(form, /Size \(optional/)
  assert.match(form, /Parking spaces \(optional/)
})
test('listingForm: pre-fills what is already known and drops that field\'s hint', () => {
  const form = listingForm({ type: 'Villa', price: 450000 })
  assert.match(form, /Type \(required\): Villa/)
  assert.match(form, /Price \(required\): 450000/)
  // An unknown field still shows its hint to guide the agent.
  assert.match(form, /Bedrooms \(optional, e\.g\. 3\):/)
})
test('listingForm: an optional hint never appears after the colon', () => {
  // Otherwise "Size (optional): m², e.g. 180" would be parsed back as the value.
  const form = listingForm()
  const fieldLines = form.split('\n').filter(l => /\((required|optional)/.test(l))
  assert.ok(fieldLines.length === CREATE_PROPERTY_STEPS.length)
  for (const line of fieldLines) {
    const after = line.slice(line.indexOf(':') + 1)
    assert.equal(after.trim(), '', `hint leaked after the colon: "${line}"`)
  }
})

// ── Parsing a filled-in form ────────────────────────────────────────────────
test('parseListingForm: reads label: value lines', () => {
  const { context, invalid } = parseListingForm([
    'Type (required): Apartment',
    'Sale or rent (required): sale',
    'City (required): Beirut',
    'Area (required): Hamra',
    'Price (required): 450k',
    'Bedrooms (optional): 3',
    'Bathrooms (optional): 2',
    'Size (optional): 180',
    'Parking spaces (optional): 1',
    'Owner name (required): Mr Khoury',
    'Owner phone (required): 03111222',
  ].join('\n'))
  assert.deepEqual(invalid, [])
  assert.equal(context.type, 'Appartement')
  assert.equal(context.transaction, 'For Sale')
  assert.equal(context.location, 'Beirut')
  assert.equal(context.neighborhood, 'Hamra')
  assert.equal(context.price, 450000)
  assert.equal(context.beds, 3)
  assert.equal(context.baths, 2)
  assert.equal(context.size, 180)
  assert.equal(context.parkings, 1)
  assert.equal(context.ownerName, 'Mr Khoury')
  assert.equal(context.ownerContact, '03111222')
})
test('parseListingForm: a blank optional is left unset, not an error', () => {
  const { context, invalid } = parseListingForm('Bedrooms (optional):\nBathrooms (optional): ')
  assert.deepEqual(invalid, [])
  assert.equal('beds' in context, false)
})
test('parseListingForm: an unparseable value is reported by its label', () => {
  const { invalid } = parseListingForm('Price (required): free\nBedrooms (optional): lots')
  assert.ok(invalid.includes('Price'))
  assert.ok(invalid.includes('Bedrooms'))
})
test('parseListingForm: tolerates the agent\'s own labels', () => {
  const { context } = parseListingForm('sqm: 200\nparking: 2\nbeds: 4\nowner number: 03999')
  assert.equal(context.size, 200)
  assert.equal(context.parkings, 2)
  assert.equal(context.beds, 4)
  assert.equal(context.ownerContact, '03999')
})
test('parseListingForm: merges onto an existing context', () => {
  const { context } = parseListingForm('Price (required): 500k', { type: 'Villa' })
  assert.equal(context.type, 'Villa')
  assert.equal(context.price, 500000)
})
test('parseListingForm: lines without a colon or a known label are ignored', () => {
  const { context, invalid } = parseListingForm('hello there\njust chatting')
  assert.deepEqual(invalid, [])
  assert.deepEqual(context, {})
})
test('a filled form round-trips through the form and the parser', () => {
  const seeded = { type: 'Villa', location: 'Beirut' }
  const parsed = parseListingForm(listingForm(seeded), {}).context
  assert.equal(parsed.type, 'Villa')
  assert.equal(parsed.location, 'Beirut')
})

// ── What is still required ──────────────────────────────────────────────────
test('missingMandatory: lists unfilled required fields', () => {
  const missing = missingMandatory({ type: 'Villa' }).map(s => s.key)
  assert.ok(missing.includes('location'))
  assert.ok(missing.includes('price'))
  assert.ok(missing.includes('ownerName'))
  assert.equal(missing.includes('type'), false)      // provided
  assert.equal(missing.includes('beds'), false)      // optional
})
test('missingMandatory: empty once every required field is present', () => {
  assert.deepEqual(missingMandatory(full), [])
})
test('missingMandatory: optionals never block saving', () => {
  // No beds/baths/size/parking, but all required present → nothing missing.
  assert.equal(missingMandatory(full).length, 0)
})

// ── Seeding from the opening message ────────────────────────────────────────
test('seedContext: form fields land in the context, extras elsewhere', () => {
  const ctx = seedContext({ beds: 3, baths: 2, size: 140, parkings: 1, rent: 1200 })
  assert.equal(ctx.beds, 3)
  assert.equal(ctx.baths, 2)      // now a real field, not an extra
  assert.equal(ctx.size, 140)
  assert.equal(ctx.parkings, 1)
  assert.deepEqual(extrasOf(ctx), { rent: 1200 })   // rent isn't a form field
})
test('seedContext: maps the aliases the model emits', () => {
  const ctx = seedContext({ bedrooms: 3, bathrooms: 2, district: 'Hamra', city: 'Beirut', owner: 'Mr K' })
  assert.equal(ctx.beds, 3)
  assert.equal(ctx.baths, 2)
  assert.equal(ctx.neighborhood, 'Hamra')
  assert.equal(ctx.location, 'Beirut')
  assert.equal(ctx.ownerName, 'Mr K')
})
test('seedContext: drops values that will not parse, ignores unknown keys', () => {
  const ctx = seedContext({ price: 'negotiable', type: 'Spaceship', company_id: 99 })
  assert.equal(ctx.price, undefined)
  assert.equal(ctx.type, undefined)
  assert.equal('company_id' in ctx, false)
})
test('seedContext: empty / no-extras cases', () => {
  assert.deepEqual(seedContext(undefined), {})
  assert.equal(EXTRA_KEY in seedContext({ beds: 3 }), false)
  assert.deepEqual(answersOf({ beds: 3 }), { beds: 3 })
  assert.deepEqual(extrasOf({}), {})
})

// ── Starting the flow, and the title ────────────────────────────────────────
test('isStartListing: recognises the obvious phrasings', () => {
  for (const s of ['add a listing', 'Add a new listing', 'create a property', 'add a villa in Hamra', 'list a new apartment']) {
    assert.ok(isStartListing(s), `should match: ${s}`)
  }
})
test('isStartListing: does not swallow unrelated messages', () => {
  for (const s of ['what properties match 500k in Beirut', 'info on Ahmed', 'mark property #23 as sold', 'done', 'help', '', "set Ahmed's budget to 400k"]) {
    assert.equal(isStartListing(s), false, `should not match: ${s}`)
  }
})
test('derivedTitle: builds a readable title', () => {
  assert.equal(derivedTitle(full), 'Appartement in Hamra')
  assert.equal(derivedTitle({ ...full, beds: 3 }), '3 bed Appartement in Hamra')
})
