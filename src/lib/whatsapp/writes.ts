// Phase 3 — turning a model's extracted fields into a safe database write.
//
// Two rules govern everything in this file:
//
//   1. A whitelist, never a passthrough. Grok decides *what the agent meant*,
//      but it must never decide *which column gets written*. Anything outside
//      the maps below is dropped and reported back, so a hallucinated field
//      name can't reach the database.
//
//   2. Extras are merged, never replaced. Several app fields (rent, agentId,
//      aiDescription, transaction...) live inside the Amenities / notes JSON
//      blobs. Writing that column wholesale silently destroys the keys you
//      didn't mention — I did exactly that to a listing during testing.
//
// Everything here is pure so it can be unit-tested without a database.

export interface FieldSpec {
  /** Real column, or "extras" to store inside the row's JSON blob. */
  column: string
  label: string
  coerce: (v: unknown) => unknown
  /** Fixed set of allowed values, if any. */
  oneOf?: string[]
}

export interface BuiltUpdate {
  /** Real columns to write. */
  columns: Record<string, unknown>
  /** Keys to merge into the row's JSON extras. */
  extras: Record<string, unknown>
  /** Human-readable "Budget: $400,000" lines for the confirmation message. */
  changes: string[]
  /** Field names that were dropped because they aren't writable. */
  rejected: string[]
}

// ── Coercions ───────────────────────────────────────────────────────────────

/** "400k", "1.2m", "$450,000" -> number. Returns null when unusable. */
export function toMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase().replace(/[$,\s]/g, '')
  const m = s.match(/^(\d+(?:\.\d+)?)([km])?$/)
  if (!m) return null
  let n = parseFloat(m[1])
  if (m[2] === 'k') n *= 1_000
  if (m[2] === 'm') n *= 1_000_000
  return Number.isFinite(n) && n > 0 ? n : null
}

export function toCount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10)
  return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null
}

export function toText(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, 500) : null
}

/** Case-insensitive match against an allowed set, returning the canonical form. */
export function toEnum(allowed: string[]) {
  return (v: unknown): string | null => {
    const s = String(v ?? '').trim().toLowerCase()
    return allowed.find(a => a.toLowerCase() === s) ?? null
  }
}

const CLIENT_STATUSES = ['Searching', 'Viewing', 'Negotiating', 'Closed', 'Inactive']
const PROPERTY_STATUSES = ['Available', 'Reserved', 'Sold', 'Rented']
export const PROPERTY_TYPES = ['Appartement', 'Villa', 'Office', 'Shop', 'Land', 'Chalet', 'Building']
export const TRANSACTIONS = ['For Sale', 'For Rent']

// ── What a WhatsApp message is allowed to change ────────────────────────────

export const CLIENT_FIELDS: Record<string, FieldSpec> = {
  // The app treats budget_max as the single budget; budget_min is kept in step
  // so the two can never disagree.
  budget:   { column: 'budget_max',        label: 'Budget',    coerce: toMoney },
  status:   { column: 'status',            label: 'Status',    coerce: toEnum(CLIENT_STATUSES), oneOf: CLIENT_STATUSES },
  location: { column: 'prefered-location', label: 'Wants',     coerce: toText },
  beds:     { column: 'bedrooms',          label: 'Bedrooms',  coerce: toCount },
  bedrooms: { column: 'bedrooms',          label: 'Bedrooms',  coerce: toCount },
  phone:    { column: 'client phone',      label: 'Phone',     coerce: toText },
  rating:   { column: 'agent_rating',      label: 'Rating',    coerce: toCount },
}

export const PROPERTY_FIELDS: Record<string, FieldSpec> = {
  status:       { column: 'Status',       label: 'Status',       coerce: toEnum(PROPERTY_STATUSES), oneOf: PROPERTY_STATUSES },
  price:        { column: 'Price',        label: 'Price',        coerce: toMoney },
  size:         { column: 'size',         label: 'Size (m²)',    coerce: toCount },
  beds:         { column: 'Bedrooms',     label: 'Bedrooms',     coerce: toCount },
  bedrooms:     { column: 'Bedrooms',     label: 'Bedrooms',     coerce: toCount },
  baths:        { column: 'bathrooms',    label: 'Bathrooms',    coerce: toCount },
  bathrooms:    { column: 'bathrooms',    label: 'Bathrooms',    coerce: toCount },
  title:        { column: 'Title',        label: 'Title',        coerce: toText },
  location:     { column: 'Location',     label: 'City',         coerce: toText },
  city:         { column: 'Location',     label: 'City',         coerce: toText },
  neighborhood: { column: 'Neighborhood', label: 'Neighbourhood', coerce: toText },
  district:     { column: 'Neighborhood', label: 'Neighbourhood', coerce: toText },
  // These live in the Amenities JSON blob, not in columns of their own.
  rent:         { column: 'extras.rent',  label: 'Rent (/mo)',   coerce: toMoney },
  notes:        { column: 'extras.notes', label: 'Notes',        coerce: toText },
  type:         { column: 'extras.type',        label: 'Type',        coerce: toEnum(PROPERTY_TYPES), oneOf: PROPERTY_TYPES },
  transaction:  { column: 'extras.transaction', label: 'Listing',     coerce: toEnum(TRANSACTIONS), oneOf: TRANSACTIONS },
  ownerName:    { column: 'extras.ownerName',    label: 'Owner',      coerce: toText },
  ownerContact: { column: 'extras.ownerContact', label: 'Owner phone', coerce: toText },
}

// ── Building an update ──────────────────────────────────────────────────────

function fmt(label: string, value: unknown): string {
  if (typeof value === 'number' && /budget|price|rent/i.test(label)) {
    return `${label}: $${value.toLocaleString('en-US')}`
  }
  return `${label}: ${value}`
}

/**
 * Map loose { field: value } pairs onto real columns. Unknown fields and
 * values that fail coercion are reported rather than guessed at.
 */
export function buildUpdate(
  fields: Record<string, unknown> | undefined,
  allowed: Record<string, FieldSpec>,
): BuiltUpdate {
  const out: BuiltUpdate = { columns: {}, extras: {}, changes: [], rejected: [] }
  if (!fields) return out

  // Index by lowercased name so lookup is case-insensitive in BOTH directions.
  // Lowercasing only the incoming key silently dropped every camelCase entry in
  // the whitelist — "ownerName" never matched, so owner details vanished.
  const index = new Map(Object.entries(allowed).map(([k, v]) => [k.toLowerCase(), v]))

  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const spec = index.get(rawKey.trim().toLowerCase())
    if (!spec) { out.rejected.push(rawKey); continue }

    const value = spec.coerce(rawValue)
    if (value === null) { out.rejected.push(rawKey); continue }

    if (spec.column.startsWith('extras.')) {
      out.extras[spec.column.slice('extras.'.length)] = value
    } else {
      out.columns[spec.column] = value
      // The single budget is stored in both columns so nothing reads a stale min.
      if (spec.column === 'budget_max') out.columns['budget_min'] = value
    }
    out.changes.push(fmt(spec.label, value))
  }

  return out
}

export function hasChanges(u: BuiltUpdate): boolean {
  return Object.keys(u.columns).length > 0 || Object.keys(u.extras).length > 0
}

/**
 * Merge new keys into a row's existing JSON blob. Parsing failures fall back to
 * an empty object rather than throwing, so one corrupt row can't wedge the bot.
 */
export function mergeExtras(existingJson: unknown, extras: Record<string, unknown>): string {
  let base: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(String(existingJson || '{}'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed
  } catch { /* corrupt blob: start clean rather than fail the write */ }
  return JSON.stringify({ ...base, ...extras })
}

/** Append a dated entry to the client's activity log inside its notes blob. */
export function appendLog(existingJson: unknown, entry: string, now: Date = new Date()): string {
  let base: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(String(existingJson || '{}'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed
  } catch { /* as above */ }
  const log = Array.isArray(base.log) ? (base.log as unknown[]) : []
  // Newest first, capped so a chatty agent can't grow the row without bound.
  const next = [{ at: now.toISOString(), note: entry.slice(0, 500) }, ...log].slice(0, 50)
  return JSON.stringify({ ...base, log: next })
}

// ── Confirmation message ────────────────────────────────────────────────────

/**
 * The message an agent must say "yes" to. It states exactly what will change,
 * because a confirmation the agent can't verify is worse than no confirmation.
 */
export function confirmationText(target: string, changes: string[], rejected: string[] = []): string {
  const lines = [`About to update ${target}:`, ...changes.map(c => `• ${c}`)]
  if (rejected.length) lines.push(`\n(Ignoring: ${rejected.join(', ')} — I can't change that from WhatsApp.)`)
  lines.push('', 'Reply YES to save or NO to cancel.')
  return lines.join('\n')
}

// ── New listing ─────────────────────────────────────────────────────────────

export interface BuiltProperty {
  columns: Record<string, unknown>
  extras: Record<string, unknown>
  changes: string[]
  missing: string[]
}

const REQUIRED_NEW = [['title', 'Title'], ['price', 'Price'], ['location', 'City']] as const

/** A new listing needs at least a title, a price and a location. */
export function buildNewProperty(fields: Record<string, unknown> | undefined): BuiltProperty {
  const u = buildUpdate(fields, PROPERTY_FIELDS)
  const missing: string[] = []
  for (const [key, label] of REQUIRED_NEW) {
    const spec = PROPERTY_FIELDS[key]
    const present = spec.column.startsWith('extras.')
      ? spec.column.slice(7) in u.extras
      : spec.column in u.columns
    if (!present) missing.push(label)
  }
  return { columns: u.columns, extras: u.extras, changes: u.changes, missing }
}
