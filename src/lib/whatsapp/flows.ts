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
  /** Required to save, vs. nice-to-have. */
  mandatory: boolean
  /** Example shown on the form line, e.g. "e.g. 450k". */
  hint?: string
  /** Other labels an agent might type for this field. */
  aliases?: string[]
  /** Natural one-line question asked when this field is missing (mandatory
   *  fields only — optional fields are never prompted for). */
  question?: string
  /** Returns the cleaned value, or null if the answer can't be used. */
  coerce: (v: unknown) => unknown
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
  { key: 'type',         label: 'Type',          mandatory: true,  hint: PROPERTY_TYPES.join('/'), coerce: coerceType, aliases: ['property type'], question: 'What type of property is it? (e.g. apartment, villa, office, shop, land)' },
  { key: 'transaction',  label: 'Sale or rent',  mandatory: true,  hint: 'sale/rent', coerce: coerceTransaction, aliases: ['transaction', 'listing', 'for sale or rent', 'buy or rent'], question: 'Is it for sale or for rent?' },
  { key: 'location',     label: 'City',          mandatory: true,  hint: 'e.g. Beirut', coerce: toText, aliases: ['location'], question: 'Which city is it in?' },
  { key: 'neighborhood', label: 'Area',          mandatory: true,  hint: 'e.g. Hamra', coerce: toText, aliases: ['neighbourhood', 'neighborhood', 'district'], question: 'Which area or neighbourhood?' },
  { key: 'price',        label: 'Price',         mandatory: true,  hint: 'USD, e.g. 450k', coerce: toMoney, aliases: ['price usd', 'asking', 'asking price'], question: "What's the asking price? (USD)" },
  { key: 'beds',         label: 'Bedrooms',      mandatory: false, hint: 'e.g. 3', coerce: toCount, aliases: ['beds', 'bed', 'br'] },
  { key: 'baths',        label: 'Bathrooms',     mandatory: false, hint: 'e.g. 2', coerce: toCount, aliases: ['baths', 'bath', 'ba'] },
  { key: 'size',         label: 'Size',          mandatory: false, hint: 'm², e.g. 180', coerce: toCount, aliases: ['sqm', 'm2', 'size m2', 'area sqm'] },
  { key: 'parkings',     label: 'Parking spaces', mandatory: false, hint: 'e.g. 1', coerce: toCount, aliases: ['parking', 'parkings', 'garage'] },
  { key: 'ownerName',    label: 'Owner name',    mandatory: true,  coerce: toText, aliases: ['owner'], question: "What's the owner's name?" },
  { key: 'ownerContact', label: 'Owner phone',   mandatory: true,  hint: 'e.g. 03 123456', coerce: toText, aliases: ['owner number', 'owner contact', 'owner phone'], question: "And the owner's phone number?" },
]

// ── Client fields ─────────────────────────────────────────────────────────────

/** Buyer or renter, from how the agent phrased it. */
const coerceClientType = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase()
  if (/\brent|tenant|lease/.test(s)) return 'Renter'
  if (/\bbuy|buyer|purchase|sale/.test(s)) return 'Buyer'
  return toEnum(['Buyer', 'Renter'])(v)
}

/**
 * Everything needed to register a client and let the matcher work: who they
 * are, how to reach them, and what they're after. Optional details refine
 * matching but don't block saving.
 */
export const CREATE_CLIENT_STEPS: FlowStep[] = [
  { key: 'name',        label: 'Name',          mandatory: true,  coerce: toText, aliases: ['client name', 'full name'], question: "What's the client's name?" },
  { key: 'phone',       label: 'Phone',         mandatory: true,  hint: 'e.g. 03 123456', coerce: toText, aliases: ['number', 'contact', 'mobile'], question: "What's their phone number?" },
  { key: 'clientType',  label: 'Buyer or renter', mandatory: true, hint: 'buyer/renter', coerce: coerceClientType, aliases: ['type', 'buyer/renter'], question: 'Are they buying or renting?' },
  { key: 'propertyType', label: 'Looking for',  mandatory: true,  hint: PROPERTY_TYPES.join('/'), coerce: coerceType, aliases: ['property type', 'wants', 'interested in'], question: 'What type of property are they after? (e.g. apartment, villa, office)' },
  { key: 'location',    label: 'Preferred area', mandatory: true, hint: 'e.g. Achrafieh', coerce: toText, aliases: ['area', 'location', 'where'], question: 'Which area are they interested in?' },
  { key: 'budget',      label: 'Budget',        mandatory: true,  hint: 'USD, e.g. 400k', coerce: toMoney, aliases: ['budget usd', 'price'], question: "What's their budget? (USD)" },
  { key: 'beds',        label: 'Bedrooms',      mandatory: false, hint: 'e.g. 3', coerce: toCount, aliases: ['beds', 'bed', 'br'] },
  { key: 'baths',       label: 'Bathrooms',     mandatory: false, hint: 'e.g. 2', coerce: toCount, aliases: ['bath', 'baths', 'wc'] },
  { key: 'parkings',    label: 'Parking spaces', mandatory: false, hint: 'e.g. 1', coerce: toCount, aliases: ['parking', 'garage', 'car spots'] },
]

// ── The all-at-once form ──────────────────────────────────────────────────────

/**
 * The fill-in form the agent copies, completes, and sends back. Any value we
 * already know (from the opening message) is pre-filled so they don't retype it.
 * Generic over the field set, so listings and clients share one renderer.
 */
export function renderForm(intro: string, steps: FlowStep[], context: FlowContext = {}): string {
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
    intro,
    'Copy this, fill in the value after each ":" and send it back. Leave optional ones blank if they don\'t apply.',
    '',
    ...lines,
  ].join('\n')
}

const clean = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/²/g, '').replace(/\s+/g, ' ').trim()

/** Find the step an agent's label refers to, by key, label, or a known alias. */
function findStep(rawLabel: string, steps: FlowStep[]): FlowStep | null {
  const c = clean(rawLabel)
  if (!c) return null
  return steps.find(s =>
    c === clean(s.key) || c === clean(s.label) || (s.aliases ?? []).some(a => clean(a) === c),
  ) ?? null
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
export function parseForm(text: string, steps: FlowStep[], base: FlowContext = {}): FormResult {
  const out: FlowContext = { ...base }
  const invalid: string[] = []

  for (const line of String(text ?? '').split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const step = findStep(line.slice(0, idx), steps)
    if (!step) continue
    const raw = line.slice(idx + 1).trim()
    if (!raw) continue   // left blank

    const value = step.coerce(raw)
    if (value === null) invalid.push(step.label)
    else out[step.key] = value
  }
  return { context: out, invalid }
}

/** Mandatory fields still empty in the context. */
export function missingMandatory(context: FlowContext, steps: FlowStep[]): FlowStep[] {
  return steps.filter(s => s.mandatory && (context[s.key] === undefined || context[s.key] === null || context[s.key] === ''))
}

/** The next mandatory field to ask about, or null when the record is complete. */
export function firstMissing(context: FlowContext, steps: FlowStep[]): FlowStep | null {
  return missingMandatory(context, steps)[0] ?? null
}

/**
 * The conversational prompt for the next missing field — one natural question at
 * a time, optionally prefixed with a short acknowledgement of what we captured
 * from the agent's last message. Returns '' when nothing is missing (the caller
 * moves on to the confirm step instead).
 */
export function nextQuestion(context: FlowContext, steps: FlowStep[], ack?: string): string {
  const step = firstMissing(context, steps)
  if (!step) return ''
  const q = step.question ?? `What's the ${step.label.toLowerCase()}?`
  return ack ? `${ack}\n${q}` : q
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

/** Does this message plainly ask to add a client/lead/buyer/renter? */
export function isStartClient(text: string | null | undefined): boolean {
  const s = (text ?? '').trim()
  if (!s) return false
  return /^(i (want|need|would like) to\s+)?(add|create|register|new|save)\b[^.!?]*\b(client|customer|lead|buyer|renter|tenant)\b/i.test(s)
}

export const LISTING_INTRO = 'Adding a listing.'
export const CLIENT_INTRO = 'Adding a client.'

/** Map an opening message's extracted fields onto a form's steps. */
export function seedForm(fields: Record<string, unknown> | undefined, steps: FlowStep[]): FlowContext {
  const out: FlowContext = {}
  if (!fields) return out
  for (const [k, v] of Object.entries(fields)) {
    const step = findStep(k, steps)
    if (!step) continue
    const value = step.coerce(v)
    if (value !== null) out[step.key] = value
  }
  return out
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
