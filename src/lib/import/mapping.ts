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
    { key: 'status', label: 'Status' },
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
  ],
}

/** { fieldKey: sourceHeader | null } */
export type Mapping = Record<string, string | null>

export function toNumber(v: string | undefined | null): number | null {
  if (v == null) return null
  const s = String(v).trim().toLowerCase()
  // "800k" / "1.2m" shorthand, common in listings. Only when the suffix follows
  // a digit, so "320 sqm" (ends in "m") is NOT read as 320 million.
  const mult = /\dk$/.test(s) ? 1_000 : /\dm$/.test(s) ? 1_000_000 : 1
  const cleaned = s.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n * mult : null
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

export interface NormProperty {
  title: string; price: number | null; city: string; district: string
  bedrooms: number | null; bathrooms: number | null; size: number | null
  transaction: 'sale' | 'rent' | null; status: string
}
export interface NormClient {
  name: string; phone: string; budget: number | null; location: string
  bedrooms: number | null; type: 'buyer' | 'renter' | null; email: string; status: string
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
        bedrooms: toNumber(cell(row, 'bedrooms')),
        bathrooms: toNumber(cell(row, 'bathrooms')),
        size: toNumber(cell(row, 'size')),
        transaction: normTransaction(cell(row, 'transaction')),
        status: cell(row, 'status') || '',
      }
      return p
    }
    const c: NormClient = {
      name: cell(row, 'name') || '',
      phone: cell(row, 'phone') || '',
      budget: toNumber(cell(row, 'budget')),
      location: cell(row, 'location') || '',
      bedrooms: toNumber(cell(row, 'bedrooms')),
      type: normClientType(cell(row, 'type')),
      email: cell(row, 'email') || '',
      status: cell(row, 'status') || '',
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
