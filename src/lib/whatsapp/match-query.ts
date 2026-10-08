// Turning "what matches …" on WhatsApp into the same search the app runs.
//
// The bot used to hand the matcher a stub: a budget, one location string, and
// empty strings for everything else. The matcher is built to take a client's
// whole brief, so with type and transaction blank nothing was excluded and with
// no bedrooms or must-haves nothing was scored — every surviving listing came
// back at 100%. An agent asking for a 2-bedroom apartment to rent at $600 was
// shown apartments for sale at $375,000, each labelled a perfect match.
//
// This builds a real brief out of what the agent said, so a chat search and the
// app's match list agree.

import type { ClientLike, PropertyMatch } from '@/lib/matching'
import { matchProperties, MATCH_THRESHOLD } from '@/lib/matching'
import { PROPERTY_TYPES, formatPrice, type Property, type PropertyType, type Transaction } from '@/lib/data'
import type { AreaIndex } from '@/lib/lebanon/areas-core'
import type { IntentResult } from './intent'

/**
 * Is this "budget" really a piece of a phone number?
 *
 * A Lebanese agent writes a client's number as "81/370740", and the classifier
 * read 370740 out of it and searched for listings at USD 370,740 — for a client
 * who wanted to rent at $600 a month. The giveaway is that the digits sit
 * inside a longer run: a real budget is the whole number, not part of one.
 */
export function budgetFromPhone(message: string, budget: number | undefined | null): boolean {
  const digits = String(Math.round(Number(budget) || 0))
  if (!Number(budget)) return false
  for (const run of digitRuns(message)) {
    // Lebanese numbers are 7–8 digits; shorter runs are prices, floors, sizes.
    if (run.length >= 7 && run !== digits && run.includes(digits)) return true
  }
  return false
}

/**
 * Digit groups joined by the separators people put inside phone numbers.
 *
 * Letters break a run, so "2 bedrooms … 600$ per month" stays separate numbers,
 * while "81/370740", "03 445 210" and "+961 3 870 377" each come back whole.
 * The slash matters: it is how half of Lebanon writes a number, and leaving it
 * out is what let a phone be read as a budget.
 */
export function digitRuns(text: string): string[] {
  return [...String(text ?? '').matchAll(/\d[\d\s/\-().+]*\d/g)].map(m => m[0].replace(/\D/g, ''))
}

// A Lebanese number, checked against the digits alone so punctuation — or the
// absence of it — makes no difference: an optional 00/961, then either a mobile
// prefix (3, 7x, 80, 81, with or without the trunk 0) or a landline one (01–09,
// which keeps its 0), then six digits.
//
// The trunk 0 on landlines is load-bearing. Allowing a bare leading digit would
// make any seven-digit number a phone, and a $1,500,000 asking price is seven
// digits.
const LEBANESE = /^(?:00)?(?:961)?(?:0?(?:3|7\d|8[01])|0[1-9])\d{6}$/

/**
 * Does this message carry a phone number?
 *
 * Used to tell a forwarded client enquiry ("Maya bejjany / 81/370740 / looking
 * for an apartment …") from an agent searching stock — a search never carries
 * somebody's number. Getting it wrong sends a person who should be saved as a
 * client into the listing matcher instead.
 */
export function containsPhoneNumber(text: string): boolean {
  return digitRuns(text).some(run => LEBANESE.test(run))
}

const TYPE_ALIASES: Record<string, PropertyType> = {
  apartment: 'Apartment', appartment: 'Apartment', appartement: 'Apartment',
  flat: 'Apartment', apt: 'Apartment', house: 'Villa', home: 'Villa',
  store: 'Shop', shop: 'Shop', depot: 'Warehouse', land: 'Land', plot: 'Land',
}

/** "appartement", "flat", "APARTMENT" → 'Apartment'. '' when it isn't a type we know. */
export function canonicalPropertyType(raw: unknown): PropertyType | '' {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return ''
  if (TYPE_ALIASES[s]) return TYPE_ALIASES[s]
  const hit = PROPERTY_TYPES.find(t => t.toLowerCase() === s)
  return hit ?? ''
}

/** "for rent", "renter", "monthly" → 'For Rent'. '' when the agent didn't say. */
export function transactionOf(...raw: unknown[]): Transaction | '' {
  const s = raw.map(v => String(v ?? '')).join(' ').toLowerCase()
  if (/rent|renter|monthly|per month|\/mo/.test(s)) return 'For Rent'
  if (/sale|sell|buy|buyer|purchase/.test(s)) return 'For Sale'
  return ''
}

/** Every area the agent named, from either the single field or the array. */
export function briefLocations(intent: IntentResult): string[] {
  const f = intent.fields ?? {}
  const raw: unknown[] = [
    ...(Array.isArray(intent.locations) ? intent.locations : []),
    ...(Array.isArray((f as Record<string, unknown>).locations) ? (f as Record<string, unknown>).locations as unknown[] : []),
    intent.location,
    (f as Record<string, unknown>).location,
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw) {
    // One field can still carry several, comma-separated.
    for (const part of String(v ?? '').split(',')) {
      const area = part.trim()
      if (!area || seen.has(area.toLowerCase())) continue
      seen.add(area.toLowerCase())
      out.push(area)
    }
  }
  return out
}

const num = (v: unknown) => (Number(v) > 0 ? Number(v) : 0)
const list = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean) : [])

/**
 * The brief to search with — the same shape the app scores a saved client by,
 * so the two produce the same list.
 */
export function briefFromIntent(intent: IntentResult): ClientLike {
  const f = (intent.fields ?? {}) as Record<string, unknown>
  const transaction = transactionOf(f.transaction, f.clientType, f.paymentTerms)
  const budget = num(intent.budget) || num(f.budget)
  const locations = briefLocations(intent)
  const features = [...list(f.features), ...list(f.amenities), ...list(f.buildingFeatures)]

  return {
    budget,
    // Only ever consulted when req.transaction is blank, and then it would force
    // a side; searchBrief() handles the unknown case by running both instead.
    type: transaction === 'For Rent' ? 'Renter' : 'Buyer',
    req: {
      transaction,
      type: canonicalPropertyType(f.type ?? f.propertyType),
      location: locations.join(', '),
      locations,
      priceMin: 0,
      priceMax: budget,
      beds: num(f.beds),
      baths: num(f.baths),
      size: num(f.size),
      parkings: num(f.parkings) || undefined,
      garden: !!f.garden,
      balcony: !!f.balcony,
      furnishing: (['Furnished', 'Semi-furnished', 'Unfurnished'] as const)
        .find(x => x.toLowerCase() === String(f.furnishing ?? '').trim().toLowerCase()) ?? '',
      amenities: features.length ? features : undefined,
      notes: '',
    },
  }
}

/**
 * Run the brief against the agency's listings.
 *
 * When the agent never said rent or sale, search both rather than guessing: the
 * matcher treats transaction as a hard filter, so picking a side would silently
 * hide half the stock — which is how a rental enquiry came back full of sales.
 */
export function searchBrief(
  brief: ClientLike,
  properties: Property[],
  areas: AreaIndex | null,
  threshold = MATCH_THRESHOLD,
): PropertyMatch[] {
  if (brief.req.transaction) return matchProperties(brief, properties, threshold, areas)

  const both = [
    ...matchProperties({ ...brief, type: 'Buyer', req: { ...brief.req, transaction: 'For Sale' } }, properties, threshold, areas),
    ...matchProperties({ ...brief, type: 'Renter', req: { ...brief.req, transaction: 'For Rent' } }, properties, threshold, areas),
  ]
  return both.sort((a, b) => b.score.total - a.score.total)
}

/** "a 2-bed Apartment to rent in Mazraat Yachouh or Ain Aar, up to USD 600/mo" */
export function describeBrief(brief: ClientLike): string {
  const { req } = brief
  const isRent = req.transaction === 'For Rent'
  const what = [
    req.beds ? `${req.beds}-bed` : null,
    req.type || 'property',
  ].filter(Boolean).join(' ')
  const where = req.locations?.length
    ? ` in ${req.locations.length > 2 ? `${req.locations.slice(0, 2).join(', ')} +${req.locations.length - 2} more` : req.locations.join(' or ')}`
    : ''
  const deal = req.transaction ? (isRent ? ' to rent' : ' to buy') : ''
  const money = brief.budget ? `, around ${formatPrice(brief.budget)}${isRent ? '/mo' : ''}` : ''
  return `${what}${deal}${where}${money}`
}

/** A listing's price in the terms the client is shopping in. */
export function listingPrice(p: Property): string {
  return p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)
}

/**
 * One line per match, each with a link the agent can tap to open the listing.
 * The link is the app's own deep link, not a public share link: this list is for
 * the agent, and a share link would expose the listing to anyone it reached.
 */
export function matchLines(matches: PropertyMatch[], origin: string): string[] {
  return matches.map(({ property, score }) => listingLines(property, origin, Math.round(score.total)))
}

/** One listing as a bullet, with its tappable link underneath. */
export function listingLines(p: Property, origin: string, scorePct?: number): string {
  const where = [p.district, p.city].filter(Boolean)[0] ?? ''
  const head = [
    `• #${p.id} ${p.title} — ${listingPrice(p)}`,
    where || null,
    scorePct != null ? `${scorePct}% match` : null,
  ].filter(Boolean).join(' · ')
  return origin ? `${head}\n  ${origin}/properties?open=${p.id}` : head
}
