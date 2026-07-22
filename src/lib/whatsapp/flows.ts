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
  question: string
  /** Returns the cleaned value, or null if the answer can't be used. */
  coerce: (v: unknown) => unknown
  /** Shown when coercion fails. */
  retry: string
}

/**
 * Ordered per the spec's required list: type, location, price, bedrooms,
 * owner name, owner contact. Transaction is asked too — without it the matcher
 * can't tell a rental from a sale, and mixing those was an explicit bug fix.
 */
export const CREATE_PROPERTY_STEPS: FlowStep[] = [
  {
    key: 'type',
    question: `What type of property? (${PROPERTY_TYPES.join(', ')})`,
    coerce: coerceType,
    retry: `I didn't recognise that type. Choose one: ${PROPERTY_TYPES.join(', ')}.`,
  },
  {
    key: 'transaction',
    question: 'Is it for sale or for rent?',
    coerce: (v: unknown) => {
      const s = String(v ?? '').trim().toLowerCase()
      if (/\brent/.test(s)) return 'For Rent'
      if (/\bsale|sell|buy/.test(s)) return 'For Sale'
      return toEnum(TRANSACTIONS)(v)
    },
    retry: 'Please reply "for sale" or "for rent".',
  },
  {
    key: 'location',
    question: 'Which city? (e.g. Beirut)',
    coerce: toText,
    retry: 'I need a city name.',
  },
  {
    key: 'neighborhood',
    question: 'Which area or neighbourhood? (e.g. Hamra)',
    coerce: toText,
    retry: 'I need an area name.',
  },
  {
    key: 'price',
    question: 'What is the price in USD? (e.g. 450k)',
    coerce: toMoney,
    retry: 'I need a number, e.g. "450k" or "450000".',
  },
  {
    key: 'beds',
    question: 'How many bedrooms? (0 if not applicable)',
    coerce: toCount,
    retry: 'I need a number of bedrooms, e.g. "3" (or "0").',
  },
  {
    key: 'ownerName',
    question: "What is the owner's name?",
    coerce: toText,
    retry: 'I need the owner\'s name.',
  },
  {
    key: 'ownerContact',
    question: "What is the owner's phone number?",
    coerce: toText,
    retry: 'I need a contact number for the owner.',
  },
]

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

/** The next question to ask, or null when everything required is collected. */
export function nextStep(context: FlowContext, steps: FlowStep[] = CREATE_PROPERTY_STEPS): FlowStep | null {
  return steps.find(s => context[s.key] === undefined || context[s.key] === null) ?? null
}

export function isComplete(context: FlowContext, steps: FlowStep[] = CREATE_PROPERTY_STEPS): boolean {
  return nextStep(context, steps) === null
}

export interface AnswerResult {
  context: FlowContext
  /** Set when the answer couldn't be used; the same step should be re-asked. */
  error?: string
}

/** Record an answer to `step`, leaving the context untouched if it won't parse. */
export function applyAnswer(step: FlowStep, answer: string, context: FlowContext): AnswerResult {
  const value = step.coerce(answer)
  if (value === null) return { context, error: step.retry }
  return { context: { ...context, [step.key]: value } }
}

/**
 * Seed a flow from whatever the opening message already contained, so an agent
 * who typed a full description isn't asked to repeat any of it.
 */
export function seedContext(fields: Record<string, unknown> | undefined, steps: FlowStep[] = CREATE_PROPERTY_STEPS): FlowContext {
  const out: FlowContext = {}
  if (!fields) return out

  // Details the agent volunteered that the flow never asks about — bathrooms,
  // size, parking. Dropping them meant "3 bed 3 bath 2 parking 140sqm" saved
  // only the bedrooms, and the agent had no way to tell.
  const extra: Record<string, unknown> = {}

  // Aliases the model tends to emit for our step keys.
  const alias: Record<string, string> = {
    bedrooms: 'beds', district: 'neighborhood', city: 'location',
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

/** Progress line, so the agent can see how much is left. */
export function progress(context: FlowContext, steps: FlowStep[] = CREATE_PROPERTY_STEPS): string {
  const done = steps.filter(s => context[s.key] !== undefined && context[s.key] !== null).length
  return `(${done}/${steps.length})`
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
