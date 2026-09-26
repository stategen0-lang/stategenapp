// Unit tests for the "Send to marketing" email (marketing-email.ts). Run: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRecipients, renderMarketingEmail, priceLine, photoDownloadUrl, htmlText, htmlArabic, MAX_MARKETING_RECIPIENTS } from './marketing-email.ts'
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
  agentPhone: '+96170111222', companyName: 'Haddad Realty', ...overrides,
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
  // Everything the team needs to identify it is on the subject line, because
  // that is all that is left carrying the listing number and the sender.
  assert.match(subject, /#45/)
  assert.match(subject, /Sea view apartment/)
  assert.match(subject, /from Nour Haddad/)
  assert.match(subject, /Kaslik, Jounieh/)
  // And the body is the two things they post: the words and the pictures.
  for (const s of ['Bright 3-bedroom', property.photos[0]]) {
    assert.ok(text.includes(s), `text missing ${s}`)
  }
  assert.ok(html.includes(property.photos[0]))
})
test('marketing email: listing text is HTML-escaped', () => {
  // The description is the only listing text left in the HTML — the title now
  // appears on the subject line, which is a header and not markup.
  const { html } = renderMarketingEmail({
    listing: publicListing(property, '<script>alert(1)</script> a & b'),
    listingId: 1, shareUrl: 'https://s/l/t', agentName: 'A',
  })
  assert.equal(html.includes('<script>'), false)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('a &amp; b'))
})
test('marketing email: the writing and nothing else', () => {
  // The agency asked for a plain email: no colours, no panels, no rounded
  // corners. Anything that creeps back in fails here.
  const { html } = email()
  for (const decoration of ['background:', 'border:', 'border-radius', 'border-top', '#F7F8FB', '#EEF0F4', 'color:#']) {
    assert.equal(html.includes(decoration), false, `the email is styling again: ${decoration}`)
  }
})

test('marketing email: a listing with no photos says nothing about photos', () => {
  // It used to end on "No photos yet." — telling the marketing team something
  // they can see for themselves, and trailing off on an apology.
  const { html, text } = email({ listing: publicListing({ ...property, photos: [] }, 'Bright flat.') })
  for (const half of [html, text]) {
    assert.equal(/photo/i.test(half), false, 'the email still mentions photos')
  }
  // It ends on the copy instead — no footer of any kind after it.
  assert.ok(text.trimEnd().endsWith('Bright flat.'), `text ended: ${JSON.stringify(text.slice(-40))}`)
  assert.ok(html.trimEnd().endsWith('</body></html>'))
  assert.equal(html.includes('Sent from StateGen'), false)
})

test('marketing email: the stamp is one plain English line', () => {
  const { html, text } = email()
  assert.ok(html.includes('<p>Stamp: Sea View</p>'), 'the stamp is not a plain line')
  assert.ok(text.startsWith('Stamp: Sea View\n'), 'the plain-text half disagrees')
  // No Arabic on the stamp — only on the description, where it was asked for.
  assert.equal(html.includes('إطلالة على البحر'), false)
  assert.equal(text.includes('إطلالة على البحر'), false)
  assert.equal(html.includes('★'), false)
})

test('priceLine: sale, rent, and no price', () => {
  assert.equal(priceLine({ transaction: 'For Sale', price: 450000, rent: 0 }), '$450,000')
  assert.equal(priceLine({ transaction: 'For Rent', price: 0, rent: 1200 }), '$1,200/month')
  assert.equal(priceLine({ transaction: 'For Sale', price: 0, rent: 0 }), 'Price on request')
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

test('marketing email: the stamp, the description, then the photos — and nothing after', () => {
  const { html, text } = email()
  const d = html.indexOf('Bright 3-bedroom'), ph = html.indexOf(property.photos[0])
  assert.ok(d > -1 && ph > -1)
  assert.ok(d < ph, `html order wrong: description ${d}, photos ${ph}`)
  assert.ok(text.indexOf('Bright 3-bedroom') < text.indexOf('Photos:'))
  // The stamp is the first line; the description follows it.
  assert.ok(text.startsWith('Stamp: '))
  assert.ok(text.indexOf('Stamp: ') < text.indexOf('Bright 3-bedroom'))
})

test('marketing email: the listing card is gone, and stays gone', () => {
  // Removed at the agency's request — the team works from the description and
  // the photos, and the card repeated the whole listing underneath them.
  const { html, text } = email()
  for (const gone of ['Listing #45', 'Contact for enquiries', 'Open listing page', 'Listing page:', 'https://stategen.app/l/tok']) {
    assert.equal(html.includes(gone), false, `html still has "${gone}"`)
    assert.equal(text.includes(gone), false, `text still has "${gone}"`)
  }
  // The facts table went with it: no label/value rows are printed any more.
  assert.equal(html.includes('Building age'), false)
  assert.equal(text.includes('Bedrooms: 3'), false)
  // But the listing number and the sender are still on the subject line, which
  // is the only place the team needs them.
  assert.match(email().subject, /New listing #45 from Nour Haddad/)
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
  assert.match(text, /^Stamp: [^\n]+\n\n180 m² appartement in Kaslik, Jounieh with 3 bedrooms and 2 bathrooms, for sale at \$450,000\./)
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

test('marketing email: the stamp leads, in English', () => {
  // The demo property is furnished-less with a sea view and credit facilities…
  const { html, text } = email({
    listing: publicListing({ ...property, amenities: ['Credit Facilities'] }, 'Bright flat.'),
  })
  assert.match(text, /^Stamp: Payment Facilities/)
  assert.ok(html.includes('Stamp: Payment Facilities'))
  // The Arabic half of the stamp is no longer sent — the agency asked for one
  // English line.
  assert.equal(html.includes('تسهيلات بالدفع'), false)
  // It sits above the description, which is the point of a stamp.
  assert.ok(html.indexOf('Payment Facilities') < html.indexOf('Bright flat.'))
})

test('marketing email: a plain listing still carries a stamp', () => {
  const { text } = email({ listing: publicListing({ ...property, view: '', amenities: [], furnishing: '' }, 'A flat.') })
  assert.match(text, /^Stamp: New Listing/)
})

// ── The agency's layout survives the trip ────────────────────────────────────
// A template is a shape — headings, bullet lists, a blank line before "More
// Features:" — and that shape is the whole reason an agency writes one. The
// email used to carry it with CSS white-space, which Outlook ignores and Gmail
// strips, so it arrived as one run-on paragraph.

const TEMPLATE_DESC = [
  'Own this 135 SQM apartment in Sarba.',
  '',
  'This apartment consists of:',
  ' - Living room',
  ' - Kitchen',
  '-3 Regular Bedrooms',
  '',
  'More Features:',
  '-2 Parkings + Visitors',
  '-Elevator 24/24',
  '',
  'Price: 135,000$ + 2.5% Commission',
  'Contact us: +961 76 884 433',
].join('\n')

test('htmlText: every line break becomes a <br>, blank lines included', () => {
  assert.equal(htmlText('a\nb'), 'a<br>b')
  assert.equal(htmlText('a\n\nb'), 'a<br><br>b')      // the blank line survives
  assert.equal(htmlText('a\r\nb'), 'a<br>b')          // Windows line endings
  assert.equal(htmlText(''), '')
  assert.equal(htmlText(null), '')
  // Indentation is held, since HTML would otherwise swallow it.
  assert.equal(htmlText('  x'), '&nbsp;&nbsp;x')
  // And it still escapes.
  assert.equal(htmlText('<b>&'), '&lt;b&gt;&amp;')
})

test('marketing email: the template keeps its shape in the HTML', () => {
  const { html } = renderMarketingEmail({
    listing: publicListing(property, TEMPLATE_DESC),
    listingId: 45, shareUrl: 'https://s/l/t', agentName: 'A',
  })
  // The blank line before each heading is a real gap, not a collapsed space.
  assert.ok(html.includes('<br><br>This apartment consists of:'), 'lost the gap before the first heading')
  assert.ok(html.includes('<br><br>More Features:'), 'lost the gap before More Features')
  assert.ok(html.includes('&nbsp;- Living room'), 'lost the indent on a list line')
  // Nothing is left depending on a CSS property email clients drop.
  assert.equal(html.includes('white-space'), false)
})

test('marketing email: a phone number reads correctly inside the Arabic', () => {
  // Arabic runs right to left, so an unmarked +961 76 884 433 was laid out as
  // "433 884 76 961+" — not a number anyone can ring.
  const { html } = renderMarketingEmail({
    listing: { ...publicListing(property, 'English copy.'), descriptionAr: 'اتصلوا بنا: +961 76 884 433' },
    listingId: 45, shareUrl: 'https://s/l/t', agentName: 'A',
  })
  assert.ok(html.includes('<span dir="ltr">+961 76 884 433</span>'), 'the phone number is not isolated')
})

test('htmlArabic: only a long run of digits is turned around', () => {
  // A bedroom count or a floor must not be touched.
  assert.equal(htmlArabic('غرفتا نوم 2'), 'غرفتا نوم 2')
  assert.equal(htmlArabic('الطابق 3'), 'الطابق 3')
  assert.ok(htmlArabic('+961 76 884 433').startsWith('<span dir="ltr">'))
})
