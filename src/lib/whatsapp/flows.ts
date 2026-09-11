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
// Only maps words that AREN'T themselves listing types. Studio, Duplex and
// Showroom used to live here (→ Appartement/Villa/Shop) but are now real types
// of their own, so they're matched exactly instead (exact match runs first in
// coerceType) — leaving them here would wrongly rewrite "duplex in Achrafieh".
const TYPE_SYNONYMS: Record<string, string> = {
  apartment: 'Appartement', appartment: 'Appartement', apt: 'Appartement',
  flat: 'Appartement', condo: 'Appartement',
  house: 'Villa', home: 'Villa',
  store: 'Shop', retail: 'Shop',
  plot: 'Land', terrain: 'Land',
  offices: 'Office', chalets: 'Chalet', buildings: 'Building',
  warehouses: 'Warehouse', depot: 'Warehouse', garages: 'Garage',
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
  { key: 'location',     label: 'Area',          mandatory: true,  hint: 'e.g. Achrafieh', coerce: toText, aliases: ['location', 'area', 'city', 'neighbourhood', 'neighborhood', 'district'], question: 'Which area is it in? (e.g. Achrafieh)' },
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
 * A list of places. Agents list areas every way imaginable —
 * "Zouk - Kaslik - Aintoura", "Jounieh, Ghazir", "Achrafieh or Sassine" — and
 * the model sometimes hands back an array instead. Returns null when empty so
 * the caller treats it as "not answered".
 */
const toList = (v: unknown): string[] | null => {
  const raw = Array.isArray(v) ? v.map(x => String(x ?? '')) : String(v ?? '').split(/[,;/]|\s-\s|\bor\b|\band\b/i)
  const out = raw.map(s => s.trim()).filter(Boolean).map(s => toText(s) as string).filter(Boolean)
  return out.length ? [...new Set(out)].slice(0, 10) : null
}

/** Furnished / semi-furnished / unfurnished, however it was phrased. */
const coerceFurnishing = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/\bsemi/.test(s)) return 'Semi-furnished'
  if (/\bunfurnish|not furnish|non[- ]?furnish|without furniture/.test(s)) return 'Unfurnished'
  if (/\bfurnish/.test(s)) return 'Furnished'
  return null
}

/** Ground / mid / last floor. "GF" is how agents write ground floor. */
const coerceFloor = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  // "No GF" / "not ground floor" is an EXCLUSION, not a preference — recording it
  // as floor:"Ground level" would ask for the exact thing the client refuses.
  // It belongs in notes, so reject it here.
  if (/\b(no|not|without|non|mesh|mish|la2)\b/.test(s)) return null
  if (/\bg\.?f\b|ground/.test(s)) return 'Ground level'
  if (/\blast\b|\btop\b|roof/.test(s)) return 'Last floor'
  if (/\bmid|middle/.test(s)) return 'Mid floor'
  return null
}

/** A yes/no answer — "yes", "bado", "3ando", true. */
const toYesNo = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^(y|yes|yep|true|1|oui|na3am|eh|aa)\b|\bwant|\bneed|\bprefer|bado|bada|badda|3ando|3anda/.test(s)) return true
  if (/^(n|no|nope|false|0|non|la2)\b|\bwithout|\bno\b/.test(s)) return false
  return null
}

/**
 * Everything needed to register a client and let the matcher work: who they
 * are, how to reach them, and what they're after. Optional details refine
 * matching but don't block saving.
 */
export const CREATE_CLIENT_STEPS: FlowStep[] = [
  { key: 'name',        label: 'Name',          mandatory: true,  coerce: toText, aliases: ['client name', 'full name', 'name of client', 'client'], question: "What's the client's name?" },
  { key: 'phone',       label: 'Phone',         mandatory: true,  hint: 'e.g. 03 123456', coerce: toText, aliases: ['number', 'contact', 'mobile'], question: "What's their phone number?" },
  { key: 'clientType',  label: 'Buyer or renter', mandatory: true, hint: 'buyer/renter', coerce: coerceClientType, aliases: ['type', 'buyer/renter', 'buying or renting', 'buy or rent', 'sale or rent', 'request sale or rent'], question: 'Are they buying or renting?' },
  { key: 'propertyType', label: 'Looking for',  mandatory: true,  hint: PROPERTY_TYPES.join('/'), coerce: coerceType, aliases: ['property type', 'wants', 'interested in'], question: 'What type of property are they after? (e.g. apartment, villa, office)' },
  { key: 'location',    label: 'Preferred area', mandatory: true, hint: 'e.g. Achrafieh', coerce: toText, aliases: ['area', 'location', 'where'], question: 'Which area are they interested in?' },
  { key: 'budget',      label: 'Budget',        mandatory: true,  hint: 'USD, e.g. 400k', coerce: toMoney, aliases: ['budget usd', 'budget range', 'price', 'price range'], question: "What's their budget? (USD)" },
  { key: 'beds',        label: 'Bedrooms',      mandatory: false, hint: 'e.g. 3', coerce: toCount, aliases: ['beds', 'bed', 'br'] },
  { key: 'baths',       label: 'Bathrooms',     mandatory: false, hint: 'e.g. 2', coerce: toCount, aliases: ['bath', 'baths', 'wc'] },
  { key: 'parkings',    label: 'Parking spaces', mandatory: false, hint: 'e.g. 1', coerce: toCount, aliases: ['parking', 'garage', 'car spots'] },
  // Optional extras below are never ASKED for (no `question`) — they're only
  // filled when the agent's own message mentioned them. Real briefs carry far
  // more than the six mandatory fields, and dropping the rest lost the brief.
  { key: 'locations',   label: 'Areas',         mandatory: false, coerce: toList, aliases: ['areas', 'areas interests', 'areas interested', 'area interests', 'preferred areas', 'locations', 'areas of interest'] },
  { key: 'size',        label: 'Min size',      mandatory: false, hint: 'm², e.g. 50', coerce: toCount, aliases: ['sqm', 'm2', 'surface', 'area sqm'] },
  { key: 'view',        label: 'View',          mandatory: false, hint: 'e.g. sea', coerce: toText, aliases: ['view type'] },
  { key: 'furnishing',  label: 'Furnishing',    mandatory: false, hint: 'furnished/unfurnished', coerce: coerceFurnishing, aliases: ['furnished', 'furniture'] },
  { key: 'floor',       label: 'Floor',         mandatory: false, hint: 'ground/mid/last', coerce: coerceFloor, aliases: ['level'] },
  { key: 'balcony',     label: 'Balcony',       mandatory: false, coerce: toYesNo, aliases: ['terrace'] },
  { key: 'advancedPayment', label: 'Can pay advance', mandatory: false, coerce: toYesNo, aliases: ['payment method', 'advance', 'advance payment', 'advanced payment', 'months ahead', 'can pay advance'] },
  { key: 'notes',       label: 'Notes',         mandatory: false, coerce: toText, aliases: ['comment', 'comments', 'comment keep in mind', 'keep in mind', 'remarks', 'note'] },
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

// A label as the agent typed it: lower case, without the hint in parentheses,
// and without the list marker the agency's own templates put in front of it
// ("1- Name", "3) Areas", "• Budget", "*Notes*" — all just the label).
const clean = (s: string) => s
  .toLowerCase()
  .replace(/\([^)]*\)/g, '')
  .replace(/²/g, '')
  .replace(/^[\s*_•·–—-]*\d+\s*[-.)\]:]?\s*/, '')   // leading "1-", "2.", "3)"
  .replace(/^[\s*_•·–—-]+/, '')                      // leading bullet/emphasis
  .replace(/[\s*_]+$/, '')
  .replace(/\s+/g, ' ')
  .trim()

/** Find the step an agent's label refers to, by key, label, or a known alias. */
function findStep(rawLabel: string, steps: FlowStep[]): FlowStep | null {
  const c = clean(rawLabel)
  if (!c) return null
  return steps.find(s =>
    c === clean(s.key) || c === clean(s.label) || (s.aliases ?? []).some(a => clean(a) === c),
  ) ?? null
}

/**
 * The client brief template agents are given to fill in. It is written the way
 * the agency already writes briefs (numbered lines, required first) and every
 * label maps to a step, so a filled-in copy is read exactly — no model call and
 * nothing guessed. Required lines are the six the bot would otherwise have to
 * ask for one at a time; the rest are only used when the agent fills them.
 */
export const CLIENT_TEMPLATE = [
  '📋 New client — copy this, fill in what you know, send it back.',
  '',
  'Required',
  '1- Name:',
  '2- Phone:',
  '3- Buying or renting:',
  '4- Looking for:',
  '5- Areas:',
  '6- Budget (USD):',
  '',
  'Optional, fill only what applies',
  '7- Bedrooms:',
  '8- Bathrooms:',
  '9- Size (m2):',
  '10- Furnished:',
  '11- View:',
  '12- Floor:',
  '13- Balcony:',
  '14- Parking:',
  '15- Advance payment:',
  '16- Notes:',
  '',
  'Several areas is fine — "Zouk, Kaslik, Aintoura". So is a range — "400$ - 450$".',
  'Anything else (schools nearby, "not close to the beach", who is moving in) goes in Notes.',
  "I'll ask for anything required you left out, and show you the client before it's saved.",
].join('\n')

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
  deriveLocation(out)
  return { context: out, invalid }
}

/**
 * Is this message a filled-in template rather than prose? True when at least
 * three different labelled lines carry a value. Three is deliberate: "info on
 * Ahmed: budget?" has one, so normal messages can't be mistaken for a form,
 * while a half-deleted template still counts.
 */
export function looksLikeForm(text: string | null | undefined, steps: FlowStep[]): boolean {
  const seen = new Set<string>()
  for (const line of String(text ?? '').split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const step = findStep(line.slice(0, idx), steps)
    if (step && line.slice(idx + 1).trim()) seen.add(step.key)
  }
  return seen.size >= 3
}

// Fields only one of the two forms has. Both carry Bedrooms, Size and an area,
// and a few labels are ambiguous on their own ("Price" reads as a client's
// budget), so the decision is which form fits BETTER — not which one fits.
const CLIENT_ONLY = ['name', 'phone', 'clientType', 'propertyType', 'locations', 'budget']
const LISTING_ONLY = ['type', 'transaction', 'price', 'ownerName', 'ownerContact']

/** Is this a filled-in copy of CLIENT_TEMPLATE (however much of it survived)? */
export function isClientForm(text: string | null | undefined): boolean {
  const s = String(text ?? '')
  if (!looksLikeForm(s, CREATE_CLIENT_STEPS)) return false
  const asClient = parseForm(s, CREATE_CLIENT_STEPS).context
  const clientHits = CLIENT_ONLY.filter(k => asClient[k] !== undefined).length
  if (clientHits < 2) return false
  const asListing = parseForm(s, CREATE_PROPERTY_STEPS).context
  return clientHits > LISTING_ONLY.filter(k => asListing[k] !== undefined).length
}

/** Does this message ask for the client template? */
export function isTemplateRequest(text: string | null | undefined): boolean {
  const s = String(text ?? '').trim()
  if (!s || s.includes('\n')) return false
  return /^(send (me )?(the )?)?(client |new client )?(template|form|format)\s*\??$/i.test(s)
    || /^(send (me )?(the )?)?(template|form|format) (for|to add) (a )?(new )?client\s*\??$/i.test(s)
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
// A scheduling message ("add a viewing … about the villa in Metn") names a
// property type but is an EVENT, not a new listing/client — exclude it so it
// isn't misrouted into a create flow.
const SCHEDULING = /\b(viewing|showing|meeting|appointment)\b/i

export function isStartListing(text: string | null | undefined): boolean {
  const s = (text ?? '').trim()
  if (!s || SCHEDULING.test(s)) return false
  return /^(i (want|need|would like) to\s+)?(add|create|list|post|register)\b[^.!?]*\b(listing|property|properties|apartment|appartement|flat|villa|office|shop|chalet|building|land|house)\b/i.test(s)
}

/** Does this message plainly ask to add a client/lead/buyer/renter? */
export function isStartClient(text: string | null | undefined): boolean {
  const s = (text ?? '').trim()
  if (!s || SCHEDULING.test(s)) return false
  return /^(i (want|need|would like) to\s+)?(add|create|register|new|save)\b[^.!?]*\b(client|customer|lead|buyer|renter|tenant)\b/i.test(s)
}

export const LISTING_INTRO = 'Adding a listing.'
export const CLIENT_INTRO = 'Adding a client.'

// "Areas interests: 5mins up from batroun 2 br" — the agency's older one-line
// briefs put the bedroom count inside the areas line. Left there it becomes part
// of the string the matcher compares against every listing's district, so lift
// it out into the field it belongs to.
const BEDS_IN_AREA = /\s*\b(\d+)\s*(?:br|beds?|bedrooms?)\b\s*/i

function liftBedsFromAreas(ctx: FlowContext): void {
  if (!Array.isArray(ctx.locations)) return
  let beds: number | null = null
  const cleaned = (ctx.locations as string[])
    .map(a => {
      const m = String(a).match(BEDS_IN_AREA)
      if (!m) return String(a)
      if (beds === null) beds = Number(m[1])
      return String(a).replace(BEDS_IN_AREA, ' ').trim()
    })
    .filter(Boolean)
  if (beds === null) return
  if (ctx.beds === undefined) ctx.beds = beds
  if (cleaned.length) ctx.locations = cleaned
  else delete ctx.locations
}

/**
 * A client brief usually lists several areas ("Zouk - Kaslik - Aintoura").
 * `location` is the mandatory single-line answer, so derive it from the list
 * rather than asking "which area?" when we already know all of them. Mutates in
 * place; every path that builds a client context runs it.
 */
function deriveLocation(ctx: FlowContext): FlowContext {
  liftBedsFromAreas(ctx)
  if (!ctx.location && Array.isArray(ctx.locations) && ctx.locations.length) {
    ctx.location = (ctx.locations as string[]).join(', ')
  }
  return ctx
}

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
  return deriveLocation(out)
}

export type FlowContext = Record<string, unknown>

/**
 * Seed a flow from whatever the opening message already contained, so an agent
 * who typed a full description isn't asked to repeat any of it.
 */
export function seedContext(fields: Record<string, unknown> | undefined, steps: FlowStep[] = CREATE_PROPERTY_STEPS): FlowContext {
  const out: FlowContext = {}
  if (!fields) return out

  // Listings now carry a single "area", so collapse a split neighbourhood/city
  // into one location, preferring the more specific neighbourhood ("Hamra"
  // over "Beirut"). The model still sometimes emits both.
  const src = { ...fields }
  const area = src.neighborhood ?? src.district ?? src.location ?? src.city
  if (area != null && String(area).trim()) {
    src.location = area
    delete src.neighborhood; delete src.district; delete src.city
  }

  // Details the agent volunteered that aren't form fields (rent, view, garden,
  // balcony, notes). Kept so a rich opening message isn't partly discarded.
  const extra: Record<string, unknown> = {}

  // Aliases the model tends to emit for our step keys.
  const alias: Record<string, string> = {
    bedrooms: 'beds', bathrooms: 'baths', sqm: 'size', m2: 'size',
    parking: 'parkings', garage: 'parkings',
    city: 'location',
    owner: 'ownerName', owner_name: 'ownerName', ownerPhone: 'ownerContact',
    owner_contact: 'ownerContact', contact: 'ownerContact',
  }

  for (const [rawKey, rawValue] of Object.entries(src)) {
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

  deriveLocation(out)

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
    context.neighborhood || context.location ? `in ${context.neighborhood || context.location}` : null,
  ].filter(Boolean)
  return parts.join(' ')
}
