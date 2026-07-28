// Phase 5 — multi-step collection for creating a listing.
//
// The spec asks for missing fields "one at a time" and keeps the partial record
// in conversation_state. That matters on WhatsApp: an agent typing on a phone
// won't re-send a six-field message because one value didn't parse, and a wall
// of "I need type, location, price, bedrooms, owner name and owner contact" is
// how a flow gets abandoned.
//
// Pure: the step order, the questions and the validation are all testable
// without a database.

// Relative, not "@/": these are runtime values, and the unit-test runner strips
// types without resolving the path alias — an aliased value import here would
// make this module unloadable in tests (the same trap as intent.ts).
import { toMoney, toCount, toText, toEnum, PROPERTY_FIELDS, PROPERTY_TYPES, TRANSACTIONS } from './writes.ts'

/**
 * Property type, tolerant of how people actually write it.
 *
 * The app stores the French spelling "Appartement" throughout. An agent who
 * typed the obvious English "Apartment" was told "I didn't recognise that type"
 * and had to guess the app's internal spelling — which happened on the first
 * real listing anyone tried to add over WhatsApp.
 */
const TYPE_SYNONYMS: Record<string, string> = {
  apartment: 'Appartement', appartment: 'Appartement', apt: 'Appartement',
  flat: 'Appartement', condo: 'Appartement', studio: 'Appartement',
  house: 'Villa', home: 'Villa', duplex: 'Villa',
  store: 'Shop', retail: 'Shop', showroom: 'Shop',
  plot: 'Land', terrain: 'Land',
  offices: 'Office', chalets: 'Chalet', buildings: 'Building',
}

export function coerceType(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  const exact = toEnum(PROPERTY_TYPES)(s)
  if (exact) return exact
  if (TYPE_SYNONYMS[s]) return TYPE_SYNONYMS[s]
  // "3 bed apartment" — find a type word anywhere in the answer.
  for (const [word, canonical] of Object.entries(TYPE_SYNONYMS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(s)) return canonical
  }
  const named = PROPERTY_TYPES.find(t => new RegExp(`\\b${t}\\b`, 'i').test(s))
  return named ?? null
}

export interface FlowStep {
  key: string
  /** Short label used on the form line, e.g. "Bedrooms". */
  label: string
  /** Conversational form, kept for a one-field re-ask. */
  question: string
  /** Required to save the listing, vs. nice-to-have. */
  mandatory: boolean
  /** Example shown on the form line, e.g. "e.g. 450k". */
  hint?: string
  /** Returns the cleaned value, or null if the answer can't be used. */
  coerce: (v: unknown) => unknown
  /** Shown when coercion fails. */
  retry: string
}

const coerceTransaction = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase()
  if (/\brent/.test(s)) return 'For Rent'
  if (/\bsale|sell|buy/.test(s)) return 'For Sale'
  return toEnum(TRANSACTIONS)(v)
}

/**
 * Every field a listing can carry, shown to the agent all at once as a form.
 * Mandatory ones must be filled before the listing saves; optional ones can be
 * left blank. Size, bathrooms and parking were missing before — agents asked
 * for them.
 */
export const CREATE_PROPERTY_STEPS: FlowStep[] = [
  { key: 'type',         label: 'Type',          mandatory: true,  hint: PROPERTY_TYPES.join('/'), coerce: coerceType,
    question: `What type of property? (${PROPERTY_TYPES.join(', ')})`, retry: `I didn't recognise that type. Choose one: ${PROPERTY_TYPES.join(', ')}.` },
  { key: 'transaction',  label: 'Sale or rent',  mandatory: true,  hint: 'sale/rent', coerce: coerceTransaction,
    question: 'Is it for sale or for rent?', retry: 'Please reply "for sale" or "for rent".' },
  { key: 'location',     label: 'City',          mandatory: true,  hint: 'e.g. Beirut', coerce: toText,
    question: 'Which city? (e.g. Beirut)', retry: 'I need a city name.' },
  { key: 'neighborhood', label: 'Area',          mandatory: true,  hint: 'e.g. Hamra', coerce: toText,
    question: 'Which area or neighbourhood? (e.g. Hamra)', retry: 'I need an area name.' },
  { key: 'price',        label: 'Price',         mandatory: true,  hint: 'USD, e.g. 450k', coerce: toMoney,
    question: 'What is the price in USD? (e.g. 450k)', retry: 'I need a number, e.g. "450k" or "450000".' },
  { key: 'beds',         label: 'Bedrooms',      mandatory: false, hint: 'e.g. 3', coerce: toCount,
    question: 'How many bedrooms?', retry: 'I need a number of bedrooms, e.g. "3".' },
  { key: 'baths',        label: 'Bathrooms',     mandatory: false, hint: 'e.g. 2', coerce: toCount,
    question: 'How many bathrooms?', retry: 'I need a number of bathrooms, e.g. "2".' },
  { key: 'size',         label: 'Size',          mandatory: false, hint: 'm², e.g. 180', coerce: toCount,
    question: 'What size in m²?', retry: 'I need a size in m², e.g. "180".' },
  { key: 'parkings',     label: 'Parking spaces', mandatory: false, hint: 'e.g. 1', coerce: toCount,
    question: 'How many parking spaces?', retry: 'I need a number of parking spaces, e.g. "1".' },
  { key: 'ownerName',    label: 'Owner name',    mandatory: true,  coerce: toText,
    question: "What is the owner's name?", retry: 'I need the owner\'s name.' },
  { key: 'ownerContact', label: 'Owner phone',   mandatory: true,  hint: 'e.g. 03 123456', coerce: toText,
    question: "What is the owner's phone number?", retry: 'I need a contact number for the owner.' },
]

// ── The all-at-once form ──────────────────────────────────────────────────────

/**
 * The fill-in form the agent copies, completes, and sends back. Any value we
 * already know (from the opening message) is pre-filled so they don't retype it.
 */
export function listingForm(context: FlowContext = {}, steps: FlowStep[] = CREATE_PROPERTY_STEPS): string {
  const lines = steps.map(s => {
    const known = context[s.key]
    const has = known !== undefined && known !== null && known !== ''
    const tag = s.mandatory ? 'required' : 'optional'
    // Hint lives in the label parentheses, never after the ":", so an unfilled
    // optional line has a genuinely empty value (the hint isn't read as one).
    const meta = has ? tag : [tag, s.hint].filter(Boolean).join(', ')
    return `${s.label} (${meta}):${has ? ' ' + known : ''}`
  })
  return [
    'Adding a listing. Copy this, fill in the value after each ":" and send it back.',
    'Leave the optional ones blank if they don\'t apply.',
    '',
    ...lines,
  ].join('\n')
}

// Words an agent might use for each field, so their labels are recognised even
// if they don't copy ours exactly.
const LABEL_ALIASES: Record<string, string> = {
  type: 'type', 'property type': 'type',
  'sale or rent': 'transaction', transaction: 'transaction', listing: 'transaction', 'for': 'transaction',
  city: 'location', location: 'location',
  area: 'neighborhood', neighbourhood: 'neighborhood', neighborhood: 'neighborhood', district: 'neighborhood',
  price: 'price', 'price usd': 'price', 'price (usd)': 'price', asking: 'price',
  bedrooms: 'beds', beds: 'beds', bed: 'beds', br: 'beds',
  bathrooms: 'baths', baths: 'baths', bath: 'baths', ba: 'baths',
  size: 'size', 'size m2': 'size', sqm: 'size', 'm2': 'size', area_sqm: 'size',
  parking: 'parkings', 'parking spaces': 'parkings', parkings: 'parkings', garage: 'parkings',
  'owner name': 'ownerName', owner: 'ownerName',
  'owner phone': 'ownerContact', 'owner number': 'ownerContact', 'owner contact': 'ownerContact', phone: 'ownerContact',
}

function normaliseLabel(raw: string): string | null {
  const clean = raw.toLowerCase()
    .replace(/\([^)]*\)/g, '')   // drop any parenthetical: "(required, e.g. 3)", "(m²)"
    .replace(/²/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return LABEL_ALIASES[clean] ?? null
}

export interface FormResult {
  context: FlowContext
  /** Fields whose supplied value couldn't be parsed, by label. */
  invalid: string[]
}

/**
 * Parse a filled-in form. Each "Label: value" line is matched to a field and
 * coerced. Blank values are skipped (an optional left empty is fine). A value
 * that won't parse is reported so the agent can fix just that one.
 */
export function parseListingForm(text: string, base: FlowContext = {}, steps: FlowStep[] = CREATE_PROPERTY_STEPS): FormResult {
  const out: FlowContext = { ...base }
  const invalid: string[] = []

  for (const line of String(text ?? '').split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = normaliseLabel(line.slice(0, idx))
    if (!key) continue
    const raw = line.slice(idx + 1).replace(/\((?:required|optional|mandatory)\)/gi, '').trim()
    if (!raw) continue   // left blank

    const step = steps.find(s => s.key === key)
    if (!step) continue
    const value = step.coerce(raw)
    if (value === null) invalid.push(step.label)
    else out[key] = value
  }
  return { context: out, invalid }
}

/** Mandatory fields still empty in the context. */
export function missingMandatory(context: FlowContext, steps: FlowStep[] = CREATE_PROPERTY_STEPS): FlowStep[] {
  return steps.filter(s => s.mandatory && (context[s.key] === undefined || context[s.key] === null || context[s.key] === ''))
}

/** Did the agent's message yield any recognised fields? */
export function looksLikeForm(text: string, steps: FlowStep[] = CREATE_PROPERTY_STEPS): boolean {
  const { context, invalid } = parseListingForm(text, {}, steps)
  return Object.keys(context).length > 0 || invalid.length > 0
}

/**
 * Does this message plainly ask to add a listing?
 *
 * Matched locally because the model is inconsistent here: "I want to add a new
 * listing" classified as create_property while the terser "add a listing" came
 * back unknown, so the flow silently failed to start. Phrasings this obvious
 * shouldn't depend on a model round-trip.
 */
export function isStartListing(text: string | null | undefined): boolean {
  const s = (text ?? '').trim()
  if (!s) return false
  return /^(i (want|need|would like) to\s+)?(add|create|list|post|register)\b[^.!?]*\b(listing|property|properties|apartment|appartement|flat|villa|office|shop|chalet|building|land|house)\b/i.test(s)
}

export type FlowContext = Record<string, unknown>

/**
 * Seed a flow from whatever the opening message already contained, so an agent
 * who typed a full description isn't asked to repeat any of it.
 */
export function seedContext(fields: Record<string, unknown> | undefined, steps: FlowStep[] = CREATE_PROPERTY_STEPS): FlowContext {
  const out: FlowContext = {}
  if (!fields) return out

  // Details the agent volunteered that aren't form fields (rent, view, garden,
  // balcony, notes). Kept so a rich opening message isn't partly discarded.
  const extra: Record<string, unknown> = {}

  // Aliases the model tends to emit for our step keys.
  const alias: Record<string, string> = {
    bedrooms: 'beds', bathrooms: 'baths', sqm: 'size', m2: 'size',
    parking: 'parkings', garage: 'parkings',
    district: 'neighborhood', city: 'location',
    owner: 'ownerName', owner_name: 'ownerName', ownerPhone: 'ownerContact',
    owner_contact: 'ownerContact', contact: 'ownerContact',
  }

  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const key = alias[rawKey] ?? rawKey
    const step = steps.find(s => s.key === key)
    if (step) {
      const value = step.coerce(rawValue)
      if (value !== null) out[key] = value
      continue
    }
    // Not a question we ask, but still a field the listing supports.
    const spec = Object.entries(PROPERTY_FIELDS).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]
    if (spec) {
      const value = spec.coerce(rawValue)
      if (value !== null) extra[key] = value
    }
  }

  if (Object.keys(extra).length) out[EXTRA_KEY] = extra
  return out
}

/** Fields collected but never asked about; merged in when the listing is saved. */
export const EXTRA_KEY = '__extra'

export function extrasOf(context: FlowContext): Record<string, unknown> {
  const e = context[EXTRA_KEY]
  return e && typeof e === 'object' && !Array.isArray(e) ? (e as Record<string, unknown>) : {}
}

/** The answered questions, without the extras bag. */
export function answersOf(context: FlowContext): FlowContext {
  const { [EXTRA_KEY]: _ignored, ...rest } = context
  return rest
}

/** A readable title when the agent never supplied one. */
export function derivedTitle(context: FlowContext): string {
  const beds = Number(context.beds) || 0
  const parts = [
    beds > 0 ? `${beds} bed` : null,
    String(context.type ?? 'Property'),
    context.neighborhood ? `in ${context.neighborhood}` : null,
  ].filter(Boolean)
  return parts.join(' ')
}
