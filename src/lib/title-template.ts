// Listing titles written from a template the agency sets once.
//
// Agents were typing every title by hand, so the same kind of listing ended up
// named five different ways. A manager writes the house pattern in Settings —
//
//   [furnished or nothing][size][type][for sale/rent] in [location]
//     → "Furnished 180 m² Apartment for sale in Kaslik"
//
// — and the New Listing form fills the title in as the agent types. The agent can
// still overwrite it; nothing here is enforced.
//
// Anything in [brackets] is a field; anything outside is kept as written. A field
// with no value disappears, and so does the wording around it, so a listing with
// no size never reads "Furnished  Apartment for sale in".
//
// Pure: no imports, so every rule is unit-tested. Run: npm test

export const DEFAULT_TITLE_TEMPLATE = '[furnished][size][type][for sale/rent] in [location]'

export interface TitleFields {
  type?: string
  transaction?: string        // "For Sale" | "For Rent"
  location?: string           // the area as the agent typed it
  size?: number | string
  beds?: number | string
  baths?: number | string
  parkings?: number | string
  floor?: string
  view?: string
  furnishing?: string
  price?: number | string
  rent?: number | string
  buildingAge?: number | string
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const money = (v: unknown) => {
  const n = num(v)
  return n > 0 ? `$${Math.round(n).toLocaleString('en-US')}` : ''
}
const plural = (n: number, one: string) => (n > 0 ? `${n} ${one}${n > 1 ? 's' : ''}` : '')

/**
 * Every field a template can use, with the words a manager might write for it.
 * Matching ignores case, spaces and punctuation, so "[for sale/ rent]",
 * "[for sale / rent]" and "[transaction]" are the same field.
 */
const FIELDS: { key: string; aliases: string[]; hint: string; value: (f: TitleFields) => string }[] = [
  {
    key: 'furnished', hint: 'Furnished / Semi-furnished (nothing when it is not)',
    aliases: ['furnished', 'furnishing', 'furnishedornothing', 'furnitureornothing', 'furniture'],
    // "or nothing": an unfurnished listing simply doesn't mention it, which is
    // how agents write titles — "Unfurnished apartment" is not a selling point.
    value: f => (/^(furnished|semi-furnished)$/i.test(String(f.furnishing ?? '').trim()) ? String(f.furnishing).trim() : ''),
  },
  { key: 'size', hint: 'e.g. 180 m²', aliases: ['size', 'm2', 'surface', 'sizem2', 'sizem²'], value: f => (num(f.size) > 0 ? `${num(f.size)} m²` : '') },
  // The same number, written the way listings here are actually written. Most
  // Lebanese agencies say SQM, not m², so the choice is a token rather than a
  // setting: a manager picks the one they want and the template shows which.
  { key: 'size sqm', hint: 'e.g. 180 SQM (how it is usually written in Lebanon)', aliases: ['sizesqm', 'sqm', 'sqmsize', 'areasqm', 'surfacesqm'], value: f => (num(f.size) > 0 ? `${num(f.size)} SQM` : '') },
  { key: 'type', hint: 'Apartment, Villa, Shop…', aliases: ['type', 'propertytype', 'property'], value: f => String(f.type ?? '').trim() },
  {
    key: 'for sale/rent', hint: 'for sale / for rent',
    aliases: ['forsalerent', 'forsaleorrent', 'saleorrent', 'transaction', 'forsale', 'forrent', 'saleRent'.toLowerCase(), 'listing'],
    value: f => {
      const t = String(f.transaction ?? '').toLowerCase()
      if (t.includes('rent')) return 'for rent'
      if (t.includes('sale')) return 'for sale'
      return ''
    },
  },
  { key: 'location', hint: 'the listing’s area', aliases: ['location', 'area', 'city', 'neighbourhood', 'neighborhood', 'district', 'where'], value: f => String(f.location ?? '').trim() },
  { key: 'beds', hint: 'e.g. 3 beds', aliases: ['beds', 'bed', 'bedrooms', 'bedroom', 'br'], value: f => plural(num(f.beds), 'bed') },
  { key: 'baths', hint: 'e.g. 2 baths', aliases: ['baths', 'bath', 'bathrooms', 'bathroom'], value: f => plural(num(f.baths), 'bath') },
  { key: 'parking', hint: 'e.g. 2 parkings', aliases: ['parking', 'parkings', 'garage'], value: f => plural(num(f.parkings), 'parking') },
  { key: 'floor', hint: 'Ground level / Mid floor / Last floor', aliases: ['floor', 'level'], value: f => String(f.floor ?? '').trim() },
  { key: 'view', hint: 'e.g. Sea view', aliases: ['view'], value: f => { const v = String(f.view ?? '').trim(); return v ? (/view$/i.test(v) ? v : `${v} view`) : '' } },
  { key: 'price', hint: 'e.g. $450,000', aliases: ['price', 'amount', 'asking'], value: f => money(f.price) },
  { key: 'rent', hint: 'e.g. $1,200/mo', aliases: ['rent', 'monthlyrent', 'rentmonth'], value: f => { const m = money(f.rent); return m ? `${m}/mo` : '' } },
  { key: 'building age', hint: 'e.g. 5 years old', aliases: ['buildingage', 'age', 'yearsold'], value: f => (num(f.buildingAge) > 0 ? `${num(f.buildingAge)} years old` : '') },
]

/** The fields a manager can use, for the help text under the setting. */
export const TITLE_FIELDS = FIELDS.map(f => ({ token: `[${f.key}]`, hint: f.hint }))

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function fieldFor(token: string) {
  const n = normalize(token)
  if (!n) return null
  return FIELDS.find(f => normalize(f.key) === n || f.aliases.some(a => normalize(a) === n)) ?? null
}

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'field'; token: string; value: string; known: boolean }

function parse(template: string, fields: TitleFields): Part[] {
  const parts: Part[] = []
  const re = /\[([^\]]*)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', text: template.slice(last, m.index) })
    const field = fieldFor(m[1])
    parts.push({ kind: 'field', token: m[1], value: field ? field.value(fields) : '', known: !!field })
    last = m.index + m[0].length
  }
  if (last < template.length) parts.push({ kind: 'text', text: template.slice(last) })
  return parts
}

/**
 * The title for a listing. Wording between two fields ("in", "-", ",") is kept
 * only when both sides have something to say, so nothing dangles.
 */
export function renderTitle(template: string | null | undefined, fields: TitleFields): string {
  // A token nobody recognises is treated as if it were never written, so the
  // words around it still read properly ("[type] [owner] in [location]" keeps
  // its "in").
  const parts = parse(String(template ?? '').trim() || DEFAULT_TITLE_TEMPLATE, fields)
    .filter(p => p.kind === 'text' || p.known)

  let text = ''
  parts.forEach((part, i) => {
    if (part.kind === 'field') {
      if (!part.value) return
      // Back-to-back fields ("[size][type]") need a space; text supplies its own.
      if (text && !/\s$/.test(text)) text += ' '
      text += part.value
      return
    }
    // Literal wording: dropped when a field it joins to has nothing to show.
    const before = [...parts.slice(0, i)].reverse().find(p => p.kind === 'field')
    const after = parts.slice(i + 1).find(p => p.kind === 'field')
    const isGlue = /\S/.test(part.text) && (!!before || !!after)
    if (isGlue && ((before && !before.value) || (after && !after.value))) return
    text += part.text
  })

  const title = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,;:·\-–—]+|[\s,;:·\-–—]+$/g, '')
    .trim()
  return title.charAt(0).toUpperCase() + title.slice(1)
}

/**
 * The two size tokens are the same field written two ways, so a manager should
 * be able to switch between them without editing the text by hand — and without
 * ending up with both in one title.
 */
export type SizeUnit = 'm2' | 'sqm'

const SIZE_TOKEN: Record<SizeUnit, string> = { m2: '[size]', sqm: '[size sqm]' }

/** Which unit a template asks for, or null when it doesn't mention the size. */
export function sizeUnitOf(template: string | null | undefined): SizeUnit | null {
  let unit: SizeUnit | null = null
  for (const p of parse(String(template ?? '').trim() || DEFAULT_TITLE_TEMPLATE, {})) {
    if (p.kind !== 'field') continue
    const f = fieldFor(p.token)
    // The last one wins, matching what the toggle then rewrites.
    if (f?.key === 'size') unit = 'm2'
    else if (f?.key === 'size sqm') unit = 'sqm'
  }
  return unit
}

/**
 * Rewrite every size token to the chosen unit, keeping the manager's own
 * wording around it. A template with no size is returned untouched — the toggle
 * is hidden in that case anyway.
 */
export function setSizeUnit(template: string | null | undefined, unit: SizeUnit): string {
  const src = String(template ?? '').trim() || DEFAULT_TITLE_TEMPLATE
  return src.replace(/\[([^\]]*)\]/g, (whole, token: string) => {
    const key = fieldFor(token)?.key
    return key === 'size' || key === 'size sqm' ? SIZE_TOKEN[unit] : whole
  })
}

/** Tokens in the template that aren't fields — shown to the manager as a warning. */
export function unknownTokens(template: string | null | undefined): string[] {
  return [...new Set(parse(String(template ?? ''), {}).filter(p => p.kind === 'field' && !p.known).map(p => `[${(p as { token: string }).token}]`))]
}
