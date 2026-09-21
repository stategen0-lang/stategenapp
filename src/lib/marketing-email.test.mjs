// Unit tests for the "Send to marketing" email (marketing-email.ts). Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRecipients, renderMarketingEmail, priceLine, detailRows, photoDownloadUrl, MAX_MARKETING_RECIPIENTS } from './marketing-email.ts'
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
  // Whoever the marketing team has to reply to is named in the subject.
  assert.match(subject, /from Nour Haddad/)
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
  // The stamp is the first line now; the description follows it.
  assert.ok(text.startsWith('★ '))
  assert.ok(text.indexOf('★ ') < text.indexOf('Bright 3-bedroom'))
})

test('marketing email: attached photos are real attachments, and clicking one downloads it', () => {
  const { html, text } = email({ attachedFiles: { 0: 'listing-45-photo-1.jpg' } })
  // Never embedded inline — Gmail hides inline images from the attachment strip.
  assert.equal(html.includes('cid:'), false)
  assert.ok(html.includes(`src="${property.photos[0]}"`))
  assert.ok(html.includes('?download=listing-45-photo-1.jpg'))
  assert.match(html, /Download all/)
  assert.match(text, /Photos: 1 \(1 attached\)/)
  // Attached photos aren't repeated as bare links in the plain-text version.
  assert.equal(text.includes(property.photos[0]), false)
})

test('marketing email: no written description still opens with one', () => {
  const { text } = renderMarketingEmail({
    listing: publicListing(property, ''), listingId: 45, shareUrl: 'https://s/l/t', agentName: 'A',
  })
  assert.match(text, /^★ [^\n]+\n\n180 m² appartement in Kaslik, Jounieh with 3 bedrooms and 2 bathrooms, for sale at \$450,000\./)
})

test('photoDownloadUrl: storage photos download, other links untouched', () => {
  assert.equal(
    photoDownloadUrl('https://x.supabase.co/storage/v1/object/public/property-photos/c/a.jpg', 'listing-1-photo-1.jpg'),
    'https://x.supabase.co/storage/v1/object/public/property-photos/c/a.jpg?download=listing-1-photo-1.jpg',
  )
  assert.equal(photoDownloadUrl('https://example.com/a.jpg', 'x.jpg'), 'https://example.com/a.jpg')
})

test('marketing email: a missing agent name leaves the subject reading normally', () => {
  const { subject } = email({ agentName: '' })
  assert.equal(subject.includes('from'), false)
  assert.match(subject, /^New listing #45 to post: /)
})

test('marketing email: the Arabic version sits under the English, right-to-left', () => {
  const arabic = 'شقة مشرقة بإطلالة على البحر، مساحتها 180 م² بسعر 450,000$.'
  const { html, text } = email({ listing: { ...publicListing(property, 'Bright 3-bedroom with open sea views.'), descriptionAr: arabic } })
  assert.ok(html.includes(arabic))
  assert.ok(html.indexOf('Bright 3-bedroom') < html.indexOf(arabic), 'Arabic must come after the English')
  assert.match(html, /dir="rtl" lang="ar"/)
  assert.ok(text.includes(arabic))
  assert.ok(text.indexOf('Bright 3-bedroom') < text.indexOf(arabic))
})

test('marketing email: no Arabic version leaves the email exactly as it was', () => {
  const { html, text } = email()
  // The stamp carries its own Arabic, so only the DESCRIPTION block is checked.
  const desc = html.slice(html.indexOf('<!-- 1. Description -->'), html.indexOf('<!-- 2. Photos -->'))
  assert.equal(desc.includes('dir="rtl"'), false)
  assert.equal(text.includes('العربية'), false)
})

test('marketing email: the stamp leads, in both languages', () => {
  // The demo property is furnished-less with a sea view and credit facilities…
  const { html, text } = email({
    listing: publicListing({ ...property, amenities: ['Credit Facilities'] }, 'Bright flat.'),
  })
  assert.match(text, /^★ PAYMENT FACILITIES · تسهيلات بالدفع/)
  assert.ok(html.includes('PAYMENT FACILITIES') || html.includes('Payment Facilities'))
  assert.ok(html.includes('تسهيلات بالدفع'))
  // It sits above the description, which is the point of a stamp.
  assert.ok(html.indexOf('Payment Facilities') < html.indexOf('Bright flat.'))
})

test('marketing email: a plain listing still carries a stamp', () => {
  const { text } = email({ listing: publicListing({ ...property, view: '', amenities: [], furnishing: '' }, 'A flat.') })
  assert.match(text, /^★ NEW LISTING · عرض جديد/)
})
