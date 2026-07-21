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
import { toMoney, toCount, toText, toEnum, PROPERTY_TYPES, TRANSACTIONS } from './writes.ts'

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
    coerce: toEnum(PROPERTY_TYPES),
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

  // Aliases the model tends to emit for our step keys.
  const alias: Record<string, string> = {
    bedrooms: 'beds', district: 'neighborhood', city: 'location',
    owner: 'ownerName', owner_name: 'ownerName', ownerPhone: 'ownerContact',
    owner_contact: 'ownerContact', contact: 'ownerContact',
  }

  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const key = alias[rawKey] ?? rawKey
    const step = steps.find(s => s.key === key)
    if (!step) continue
    const value = step.coerce(rawValue)
    if (value !== null) out[key] = value
  }
  return out
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
