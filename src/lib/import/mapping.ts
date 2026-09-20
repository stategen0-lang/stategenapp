// Import field definitions + the pure transform that turns raw spreadsheet rows
// into normalised property/client objects, given a column mapping. The mapping
// itself is inferred by the AI (src/lib/ai/import-map.ts) but applied here in
// code, so a 500-row sheet costs one AI call, not 500.

export type ImportKind = 'properties' | 'clients'

export interface FieldDef {
  key: string
  label: string
  required?: boolean
}

// The fields we can fill from a sheet. Order = display order in the mapping UI.
export const FIELDS: Record<ImportKind, FieldDef[]> = {
  properties: [
    { key: 'title', label: 'Title / description', required: true },
    { key: 'price', label: 'Price (USD)' },
    { key: 'city', label: 'City / area' },
    { key: 'district', label: 'District / neighborhood' },
    { key: 'bedrooms', label: 'Bedrooms' },
    { key: 'bathrooms', label: 'Bathrooms' },
    { key: 'size', label: 'Size (m²)' },
    { key: 'transaction', label: 'Sale or rent' },
    { key: 'type', label: 'Property type (apartment, villa, office…)' },
    { key: 'status', label: 'Status' },
    { key: 'ownerContact', label: 'Owner phone / contact' },
    { key: 'reference', label: 'Reference / listing number' },
    { key: 'notes', label: 'Notes' },
  ],
  clients: [
    { key: 'name', label: 'Client name', required: true },
    { key: 'phone', label: 'Phone' },
    { key: 'budget', label: 'Budget (USD)' },
    { key: 'location', label: 'Preferred location' },
    { key: 'bedrooms', label: 'Bedrooms wanted' },
    { key: 'type', label: 'Buyer or renter' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Notes' },
  ],
}

/** { fieldKey: sourceHeader | null } */
export type Mapping = Record<string, string | null>

export function toNumber(v: string | undefined | null): number | null {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  // A range ("500-700k", "500k - 700k", "500 to 700k") reads as its upper end —
  // for a budget that is what the client can stretch to. A suffix on only the
  // last number ("500-700k") applies to both.
  const range = s.match(/^\D*?(\d[\d.,]*)\s*([km])?\s*(?:-|–|—|to)\s*\D*?(\d[\d.,]*)\s*([km])?\b/)
  if (range) {
    const suffix = range[4] ?? range[2] ?? ''
    return parseSingle(range[3] + suffix)
  }
  return parseSingle(s)
}

function parseSingle(s: string): number | null {
  // "800k" / "1.2m" shorthand, common in listings. Only when the suffix follows
  // a digit, so "320 sqm" (ends in "m") is NOT read as 320 million.
  const mult = /\dk$/.test(s) ? 1_000 : /\dm$/.test(s) ? 1_000_000 : 1
  const cleaned = s.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n * mult : null
}

/** Bedroom counts: "3+1" means 3 bedrooms plus a maid's room — count the 3. */
export function toBeds(v: string | undefined | null): number | null {
  if (v == null) return null
  const m = String(v).match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/** Size in m². Strips the unit first so the "2" in "m2" isn't read as a digit,
 *  and converts square feet. */
export function toSize(v: string | undefined | null): number | null {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  const isFeet = /sq\.?\s?ft|sqft|ft2|ft²|feet/.test(s)
  const n = toNumber(s.replace(/sq\.?\s?ft|sqft|ft2|ft²|feet|sq\.?\s?m|sqm|m2|m²|meters?|metres?/g, ' '))
  if (n == null) return null
  return isFeet ? Math.round(n * 0.092903) : n
}

export function normTransaction(v: string | undefined): 'sale' | 'rent' | null {
  const s = String(v ?? '').toLowerCase()
  if (/rent|lease|إيجار|ايجار/.test(s)) return 'rent'
  if (/sale|sell|buy|for sale|بيع|للبيع/.test(s)) return 'sale'
  return null
}

export function normClientType(v: string | undefined): 'buyer' | 'renter' | null {
  const s = String(v ?? '').toLowerCase()
  if (/rent|lease|tenant|renter|إيجار|مستأجر/.test(s)) return 'renter'
  if (/buy|sale|purchase|buyer|شراء|مشتري/.test(s)) return 'buyer'
  return null
}

const TYPE_RULES: [RegExp, string][] = [
  [/duplex|دوبلكس/i, 'Duplex'],
  [/studio|ستوديو/i, 'Studio'],
  [/villa|فيلا/i, 'Villa'],
  [/chalet|شاليه/i, 'Chalet'],
  [/apartment|appartement|apt\b|flat|penthouse|شقة/i, 'Appartement'],
  [/\bland\b|\bplot\b|terrain|أرض|ارض/i, 'Land'],
  [/office|مكتب/i, 'Office'],
  [/showroom|معرض/i, 'Showroom'],
  [/restaurant|مطعم/i, 'Restaurant'],
  [/\bshop\b|\bstore\b|boutique|محل/i, 'Shop'],
  [/warehouse|depot|مستودع/i, 'Warehouse'],
  [/garage|parking|كراج/i, 'Garage'],
  [/standalone|\bhouse\b|بيت/i, 'Standalone'],
  [/building|مبنى|بناية/i, 'Building'],
]

/** The app's property type from free text — a type column first, then the
 *  title. Falls back to Appartement, the most common listing. */
export function guessPropertyType(...texts: (string | undefined)[]): string {
  for (const t of texts) {
    if (!t) continue
    const hit = TYPE_RULES.find(([re]) => re.test(t))
    if (hit) return hit[1]
  }
  return 'Appartement'
}

const PROPERTY_STATUSES = ['Available', 'Pending', 'Sold', 'Rented', 'Reserved', 'Under Construction']

/** A sheet's status text as one of the app's statuses. Anything unrecognised
 *  (blank, "active", "for sale", "open"…) becomes Available. */
export function normPropertyStatus(v: string | undefined): string {
  const s = String(v ?? '').trim().toLowerCase()
  const exact = PROPERTY_STATUSES.find(x => x.toLowerCase() === s)
  if (exact) return exact
  if (/sold|مباع/.test(s)) return 'Sold'
  if (/rented|leased|مؤجر/.test(s)) return 'Rented'
  if (/reserv|محجوز/.test(s)) return 'Reserved'
  if (/pend|hold|deposit/.test(s)) return 'Pending'
  if (/construct|off.?plan|قيد الإنشاء/.test(s)) return 'Under Construction'
  return 'Available'
}

const CLIENT_STATUSES = ['Searching', 'Viewing', 'Negotiation', 'Signed']

export function normClientStatus(v: string | undefined): string {
  const s = String(v ?? '').trim().toLowerCase()
  return CLIENT_STATUSES.find(x => x.toLowerCase() === s) ?? 'Searching'
}

export interface NormProperty {
  title: string; price: number | null; city: string; district: string
  bedrooms: number | null; bathrooms: number | null; size: number | null
  transaction: 'sale' | 'rent' | null; status: string
  type: string; ownerContact: string; notes: string
}
export interface NormClient {
  name: string; phone: string; budget: number | null; location: string
  bedrooms: number | null; type: 'buyer' | 'renter' | null; email: string; status: string
  notes: string
}

/** Key used to spot a row already in the file or already in the database. */
export function dedupeKey(kind: ImportKind, obj: NormProperty | NormClient): string {
  const norm = (x: unknown) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (kind === 'properties') {
    const p = obj as NormProperty
    return ['p', norm(p.title), norm(p.city), norm(p.district), p.price ?? '', p.transaction ?? ''].join('|')
  }
  const c = obj as NormClient
  return ['c', norm(c.name), norm(c.phone).replace(/[^\d+]/g, '')].join('|')
}

/** Turn raw rows into normalised objects using the mapping. */
export function applyMapping(kind: ImportKind, headers: string[], rows: string[][], mapping: Mapping): (NormProperty | NormClient)[] {
  const colOf = new Map(headers.map((h, i) => [h, i]))
  const cell = (row: string[], key: string): string | undefined => {
    const header = mapping[key]
    if (!header) return undefined
    const i = colOf.get(header)
    return i == null ? undefined : (row[i] ?? '').trim()
  }

  return rows.map(row => {
    if (kind === 'properties') {
      const p: NormProperty = {
        title: cell(row, 'title') || '',
        price: toNumber(cell(row, 'price')),
        city: cell(row, 'city') || '',
        district: cell(row, 'district') || '',
        bedrooms: toBeds(cell(row, 'bedrooms')),
        bathrooms: toBeds(cell(row, 'bathrooms')),
        size: toSize(cell(row, 'size')),
        transaction: normTransaction(cell(row, 'transaction')),
        status: normPropertyStatus(cell(row, 'status')),
        type: guessPropertyType(cell(row, 'type'), cell(row, 'title')),
        ownerContact: cell(row, 'ownerContact') || '',
        notes: [cell(row, 'reference') ? `Ref ${cell(row, 'reference')}` : '', cell(row, 'notes') || ''].filter(Boolean).join(' · '),
      }
      return p
    }
    const c: NormClient = {
      name: cell(row, 'name') || '',
      phone: cell(row, 'phone') || '',
      budget: toNumber(cell(row, 'budget')),
      location: cell(row, 'location') || '',
      bedrooms: toBeds(cell(row, 'bedrooms')),
      type: normClientType(cell(row, 'type')),
      email: cell(row, 'email') || '',
      status: normClientStatus(cell(row, 'status')),
      notes: cell(row, 'notes') || '',
    }
    return c
  })
}

/** A row is worth importing only if its required field is present. */
export function isValidRow(kind: ImportKind, obj: NormProperty | NormClient): boolean {
  if (kind === 'properties') {
    const p = obj as NormProperty
    return !!(p.title || p.price)   // need at least something identifying
  }
  const c = obj as NormClient
  return !!c.name
}
