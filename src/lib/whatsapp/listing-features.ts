// Sorting a listing's features into the web form's checkboxes and fields.
//
// An agent adding a listing over WhatsApp writes "mid floor, generator, parking,
// sea view, heating system". Those used to land in the listing's internal notes,
// so none of the form's tick-boxes were ticked. This maps each feature onto the
// field the web form shows — a checkbox, the floor/furnishing selects, the view,
// the parking count — and keeps only what has no field (here: "heating system")
// in the notes.
//
// Pure: relative imports only, so the test runner can load it. Run: npm test

// Canonical names must match the web form exactly — its checkboxes compare by
// string. (Kept in sync with PROPERTY_AMENITIES / BUILDING_FEATURES in data.ts.)
export const LISTING_AMENITIES = ['Pool', "Helper's Room", 'Air Conditioning', 'Credit Facilities', 'Prime Location'] as const
// Land-only boxes (the web form offers these for a plot). Kept as their own
// list so the sync test can check each against its counterpart in data.ts.
export const LISTING_LAND_AMENITIES = ['Flat Land (0% slope)', 'Road Access', 'Building Permit'] as const
export const LISTING_BUILDING_FEATURES = [
  'Concierge', '24/7 Security', 'Elevator', 'Gym', 'Shared Pool',
  'Shared Spaces', 'Storage Room', 'Generator', 'Water Well', 'Solar Panels',
] as const

export interface ListingFeatureFields {
  garden?: boolean
  balcony?: boolean
  terrace?: boolean
  needsRenovation?: boolean
  floor?: 'Ground level' | 'Mid floor' | 'Last floor'
  furnishing?: 'Furnished' | 'Semi-furnished' | 'Unfurnished'
  view?: string
  parkings?: number
  amenities?: string[]
  buildingFeatures?: string[]
}

export interface SortedFeatures {
  fields: ListingFeatureFields
  /** Features that have no field, joined for the notes. */
  unmatched: string[]
}

type Rule = { test: RegExp; apply: (f: ListingFeatureFields, m: RegExpMatchArray) => void }

const addTo = (key: 'amenities' | 'buildingFeatures', name: string) => (f: ListingFeatureFields) => {
  const list = f[key] ?? []
  if (!list.includes(name)) f[key] = [...list, name]
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

// Order matters: specific phrases before the general ones they contain
// ("shared pool" before "pool", "semi furnished" before "furnished").
const RULES: Rule[] = [
  // Floor
  { test: /^(?:mid(?:dle)?|intermediate)\s*(?:floor|level)$/i, apply: f => { f.floor = 'Mid floor' } },
  { test: /^(?:last|top|highest)\s*(?:floor|level)$|^roof(?:top)?$|^penthouse$/i, apply: f => { f.floor = 'Last floor' } },
  { test: /^(?:ground\s*(?:floor|level)|g\.?f\.?)$/i, apply: f => { f.floor = 'Ground level' } },

  // Furnishing
  { test: /^semi[\s-]*furnished$/i, apply: f => { f.furnishing = 'Semi-furnished' } },
  { test: /^(?:un|non[\s-]*|not\s+)furnished$|^empty$/i, apply: f => { f.furnishing = 'Unfurnished' } },
  { test: /^(?:fully\s+)?furnished$|^mfarsh(?:e|a)?$/i, apply: f => { f.furnishing = 'Furnished' } },

  // View: "sea view", "open mountain view", "view on the sea", bare "view"
  { test: /^(?:open\s+|panoramic\s+|nice\s+|great\s+|unblock(?:ed|able)\s+)?(sea|mountain|city|garden|pool|valley|forest|river|lake|golf|park|street)\s+view$/i, apply: (f, m) => { f.view = cap(m[1]) } },
  { test: /^view\s+(?:on|of|to)\s+(?:the\s+)?(sea|mountains?|city|garden|valley)$/i, apply: (f, m) => { f.view = cap(m[1].replace(/s$/, '')) } },
  { test: /^(?:open|panoramic|nice|great|unblock(?:ed|able))?\s*view$/i, apply: f => { f.view ??= 'Open' } },

  // Outdoor + condition (their own checkboxes)
  { test: /^(?:private\s+)?garden$/i, apply: f => { f.garden = true } },
  { test: /^balcon(?:y|ies)$/i, apply: f => { f.balcony = true } },
  { test: /^terraces?$|^roof\s*terrace$/i, apply: f => { f.terrace = true } },
  { test: /^needs?\s+renovation$|^to\s+(?:be\s+)?renovate(?:d)?$|^old\s+condition$/i, apply: f => { f.needsRenovation = true } },

  // Parking: "parking", "2 parkings", "covered parking", "garage"
  { test: /^(\d{1,2})\s*(?:parkings?|parking\s+(?:spots?|spaces?|lots?)|car\s*parks?|garages?)$/i, apply: (f, m) => { f.parkings = Number(m[1]) } },
  { test: /^(?:(?:private|covered|underground|indoor)\s+)?(?:parkings?|parking\s+(?:spot|space|lot)|car\s*park|garage)$/i, apply: f => { f.parkings ??= 1 } },

  // Building features
  { test: /^(?:shared|common|building)\s+(?:swimming\s+)?pool$/i, apply: addTo('buildingFeatures', 'Shared Pool') },
  { test: /^(?:elevators?|lifts?|asanseur)$/i, apply: addTo('buildingFeatures', 'Elevator') },
  { test: /^(?:generator|moteur|backup\s+power|24\s*\/\s*(?:7|24)\s+electricity|electricity\s+24\s*\/\s*(?:7|24)|24\s*h(?:ours?)?\s+electricity)$/i, apply: addTo('buildingFeatures', 'Generator') },
  { test: /^(?:24\s*\/\s*7\s+)?(?:security|guards?|security\s+guards?)$|^gated(?:\s+community)?$/i, apply: addTo('buildingFeatures', '24/7 Security') },
  { test: /^(?:concierge|doorman|natou?r|natour|nator|natoor|bawwab)$/i, apply: addTo('buildingFeatures', 'Concierge') },
  { test: /^gym(?:nasium)?$|^fitness(?:\s+(?:center|centre|room))?$/i, apply: addTo('buildingFeatures', 'Gym') },
  { test: /^(?:shared|common)\s+(?:spaces?|areas?)$|^lobby$/i, apply: addTo('buildingFeatures', 'Shared Spaces') },
  { test: /^storage(?:\s+room)?$|^depot$|^cave$/i, apply: addTo('buildingFeatures', 'Storage Room') },
  { test: /^(?:water\s+)?well$|^artesian\s+well$/i, apply: addTo('buildingFeatures', 'Water Well') },
  { test: /^solar(?:\s+(?:panels?|energy|system|power))?$/i, apply: addTo('buildingFeatures', 'Solar Panels') },

  // Unit amenities
  { test: /^(?:private\s+)?(?:swimming\s+)?pool$/i, apply: addTo('amenities', 'Pool') },
  { test: /^(?:maid'?s?|helper'?s?|service|nanny)\s*(?:room|quarters?)$/i, apply: addTo('amenities', "Helper's Room") },
  { test: /^(?:a\s*\/?\s*c|air\s*con(?:ditioning|ditioner|ditioners)?|aircon|(?:split|central)\s+(?:a\s*\/?\s*c|air\s*conditioning))$/i, apply: addTo('amenities', 'Air Conditioning') },
  { test: /^(?:credit\s+facilit(?:y|ies)|payment\s+facilit(?:y|ies)|bank\s+loan|housing\s+loan|mortgage|loan|credit|installments?|taksit)$/i, apply: addTo('amenities', 'Credit Facilities') },
  { test: /^(?:prime|premium|top|excellent|great|best)\s+(?:location|spot|area)$/i, apply: addTo('amenities', 'Prime Location') },
  // Land only, but harmless anywhere: the stamp and the form read the name.
  { test: /^(?:flat|level|even)(?:\s+land)?$|^(?:0\s*%?\s*|no\s+)slope$/i, apply: addTo('amenities', 'Flat Land (0% slope)') },
  { test: /^(?:road\s+access|on\s+(?:the\s+)?road|accessible\s+by\s+road)$/i, apply: addTo('amenities', 'Road Access') },
  { test: /^(?:building\s+permit|permit|rukhsa|rokhsa)$/i, apply: addTo('amenities', 'Building Permit') },
]

// Words around a feature that don't change what it is: "with a generator",
// "has elevator", "parking included", "bada balcony".
const FILLER_START = /^(?:(?:with|w\/?|and|plus|has|have|having|includes?|including|there\s+is|there'?s|it\s+has|equipped\s+with|bado|bada|fi|3ando|3anda|a|an|the|its?|own|full)\s+)+/i
const FILLER_END = /\s+(?:included|available|installed|provided|too|also|as\s+well)$/i

// A clause that negates or conditions a feature is context, not a checkbox:
// "no elevator", "without parking", "not furnished yet", "ma fi generator".
const NEGATED = /\b(?:no|not|non|without|w\/o|except|lacks?|missing|none|ma\s+fi|mafi|mesh|mish|bala|bidun|maybe|possible|possibly|could|can\s+be|if)\b/i

export function normalizeFeature(raw: string): string {
  return raw.trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ')
    .replace(FILLER_START, '').replace(FILLER_END, '').trim()
}

/** Try to place one feature; true when it matched a field. */
function place(fields: ListingFeatureFields, raw: string): boolean {
  // "unfurnished" / "not furnished" answer the furnishing question; they aren't
  // a negated feature.
  if (NEGATED.test(raw) && !/^(?:non|not)[\s-]*furnished$/i.test(raw.trim())) return false
  const phrase = normalizeFeature(raw)
  if (!phrase) return false
  for (const rule of RULES) {
    const m = phrase.match(rule.test)
    if (m) { rule.apply(fields, m); return true }
  }
  return false
}

/** Split a comma/“and”/line separated list of features into single phrases. */
export function splitFeatures(input: unknown): string[] {
  const parts = Array.isArray(input) ? input.map(x => String(x ?? '')) : String(input ?? '').split(/[,;\n•]+|\s+&\s+|\s+\+\s+/)
  return parts
    .flatMap(p => p.split(/\s+and\s+(?=\S)/i))
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Sort a list of features (what the agent or the model listed) into fields.
 * Anything that doesn't map — or that is negated — is returned as unmatched,
 * for the notes, in the agent's own words.
 */
export function sortListingFeatures(features: unknown): SortedFeatures {
  const fields: ListingFeatureFields = {}
  const unmatched: string[] = []
  for (const f of splitFeatures(features)) {
    if (!place(fields, f)) unmatched.push(f)
  }
  return { fields, unmatched }
}

/**
 * Pull features out of free-text notes. Only a clause that is JUST a feature
 * ("generator", "with elevator") is moved; a clause with anything else in it
 * ("owner wants cash, elevator broken") stays in the notes untouched, so nothing
 * the agent wrote is lost or misread.
 */
export function extractFeaturesFromNotes(notes: unknown): { fields: ListingFeatureFields; notes: string } {
  const text = String(notes ?? '').trim()
  const fields: ListingFeatureFields = {}
  if (!text) return { fields, notes: '' }
  const kept: string[] = []
  for (const clause of text.split(/[,;\n•]+|\.\s+|\.$/)) {
    const c = clause.trim()
    if (!c) continue
    // "parking and elevator" — move only if EVERY part is a feature.
    const parts = splitFeatures(c)
    const trial: ListingFeatureFields = {}
    if (parts.length && parts.every(p => place(trial, p))) {
      for (const p of parts) place(fields, p)
    } else {
      kept.push(c)
    }
  }
  return { fields, notes: kept.join(', ') }
}

/**
 * Merge feature fields onto what's already known. An explicit value wins (a
 * "floor" the agent stated beats one found in a list); checkbox lists union.
 */
export function mergeFeatureFields(base: ListingFeatureFields, add: ListingFeatureFields): ListingFeatureFields {
  const out: ListingFeatureFields = { ...base }
  for (const key of ['garden', 'balcony', 'terrace', 'needsRenovation'] as const) {
    if (add[key]) out[key] = true
  }
  for (const key of ['floor', 'furnishing', 'view', 'parkings'] as const) {
    if (out[key] === undefined && add[key] !== undefined) (out as Record<string, unknown>)[key] = add[key]
  }
  for (const key of ['amenities', 'buildingFeatures'] as const) {
    const merged = [...new Set([...(base[key] ?? []), ...(add[key] ?? [])])]
    if (merged.length) out[key] = merged
  }
  return out
}
