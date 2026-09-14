// Unit tests for the "Send to marketing" email (marketing-email.ts). Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRecipients, renderMarketingEmail, priceLine, detailRows, MAX_MARKETING_RECIPIENTS } from './marketing-email.ts'
import { publicListing } from './share.ts'

const property = {
  id: 45, title: 'Sea view apartment', type: 'Appartement', transaction: 'For Sale',
  price: 450000, rent: 0, district: 'Kaslik', city: 'Jounieh', size: 180, beds: 3, baths: 2,
  garden: false, balcony: true, terrace: false, view: 'Sea', parkings: 2, furnishing: 'Unfurnished',
  amenities: ['Generator'], buildingFeatures: ['Elevator'], status: 'Available', agentId: 'NH-1',
  photos: ['https://x.supabase.co/storage/v1/object/public/property-photos/company-1/a.jpg'],
  // Private — must never reach an email that leaves the company.
  ownerName: 'Georges Haddad', ownerContact: '03 987 654', notes: 'owner wants cash only',
  documentPath: 'company-1/deed.pdf', documentName: 'deed.pdf', mapUrl: 'https://maps.google.com/?q=33.9,35.6',
  referredBy: 'Partner Realty',
}

const email = (overrides = {}) => renderMarketingEmail({
  listing: publicListing(property, 'Bright 3-bedroom with open sea views.'),
  listingId: 45, shareUrl: 'https://stategen.app/l/tok', agentName: 'Nour Haddad',
  agentPhone: '+96170111222', companyName: 'Haddad Realty', brandColor: '#1A2B4A', ...overrides,
})

test('marketing email: never contains the owner, notes, documents or map pin', () => {
  const { subject, html, text } = email()
  for (const secret of ['Georges', '987 654', '987654', 'cash only', 'deed', 'maps.google', 'Partner Realty']) {
    assert.equal(html.includes(secret), false, `html leaked: ${secret}`)
    assert.equal(text.includes(secret), false, `text leaked: ${secret}`)
    assert.equal(subject.includes(secret), false, `subject leaked: ${secret}`)
  }
})

test('marketing email: carries what a post needs', () => {
  const { subject, html, text } = email()
  assert.match(subject, /#45/)
  assert.match(subject, /Sea view apartment/)
  for (const s of ['$450,000', 'Kaslik, Jounieh', '180 m²', 'Nour Haddad', '+96170111222', 'https://stategen.app/l/tok', property.photos[0], 'Bright 3-bedroom']) {
    assert.ok(text.includes(s), `text missing ${s}`)
  }
  assert.ok(html.includes(property.photos[0]))
})

test('marketing email: listing text is HTML-escaped', () => {
  const { html } = renderMarketingEmail({
    listing: publicListing({ ...property, title: '<script>alert(1)</script>' }, 'a & b'),
    listingId: 1, shareUrl: 'https://s/l/t', agentName: 'A',
  })
  assert.equal(html.includes('<script>'), false)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('a &amp; b'))
})

test('marketing email: an unsafe brand colour falls back to the default', () => {
  const { html } = email({ brandColor: 'red;background:url(x)' })
  assert.equal(html.includes('url(x)'), false)
  assert.ok(html.includes('#14223F'))
})

test('priceLine: sale, rent, and no price', () => {
  assert.equal(priceLine({ transaction: 'For Sale', price: 450000, rent: 0 }), '$450,000')
  assert.equal(priceLine({ transaction: 'For Rent', price: 0, rent: 1200 }), '$1,200/month')
  assert.equal(priceLine({ transaction: 'For Sale', price: 0, rent: 0 }), 'Price on request')
})

test('detailRows: skips empty facts', () => {
  const rows = detailRows(publicListing({ ...property, size: 0, beds: 0, parkings: 0, view: '', amenities: [], buildingFeatures: [] }, ''))
  const keys = rows.map(r => r[0])
  for (const k of ['Size', 'Bedrooms', 'Parking', 'View', 'Amenities']) assert.equal(keys.includes(k), false, k)
})

test('parseRecipients: one or several addresses, cleaned', () => {
  assert.deepEqual(parseRecipients('Marketing@Agency.com'), { ok: true, emails: ['marketing@agency.com'] })
  assert.deepEqual(parseRecipients('a@x.com, b@x.com; a@x.com'), { ok: true, emails: ['a@x.com', 'b@x.com'] })
  assert.deepEqual(parseRecipients(''), { ok: true, emails: [] })
})

test('parseRecipients: names the bad address, caps the count', () => {
  const bad = parseRecipients('a@x.com, not-an-email')
  assert.equal(bad.ok, false)
  assert.match(bad.error, /not-an-email/)
  const many = Array.from({ length: MAX_MARKETING_RECIPIENTS + 1 }, (_, i) => `m${i}@x.com`).join(',')
  assert.equal(parseRecipients(many).ok, false)
})

test('marketing email: description first, then photos, then the listing card', () => {
  const { html, text } = email()
  const d = html.indexOf('Bright 3-bedroom'), ph = html.indexOf(property.photos[0]), card = html.indexOf('Listing #45')
  assert.ok(d > -1 && ph > -1 && card > -1)
  assert.ok(d < ph && ph < card, `html order wrong: description ${d}, photos ${ph}, card ${card}`)
  assert.ok(text.indexOf('Bright 3-bedroom') < text.indexOf('Photos:'))
  assert.ok(text.indexOf('Photos:') < text.indexOf('Listing #45'))
  assert.ok(text.startsWith('Bright 3-bedroom'))
})

test('marketing email: an attached photo is shown from its attachment', () => {
  const { html, text } = email({ attachedCids: { 0: 'listing45-photo1@stategen' } })
  assert.ok(html.includes('src="cid:listing45-photo1@stategen"'))
  assert.match(text, /Photos: 1 \(1 attached\)/)
  // Attached photos aren't repeated as bare links in the plain-text version.
  assert.equal(text.includes(property.photos[0]), false)
})

test('marketing email: no written description still opens with one', () => {
  const { text } = renderMarketingEmail({
    listing: publicListing(property, ''), listingId: 45, shareUrl: 'https://s/l/t', agentName: 'A',
  })
  assert.match(text, /^180 m² appartement in Kaslik, Jounieh with 3 bedrooms and 2 bathrooms, for sale at \$450,000\./)
})
