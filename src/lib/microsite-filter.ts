// Filtering and sorting the public agency microsite's listings (/a/<agency>).
// Pure, so the rules are unit-tested; the page's client component only holds
// the state and mirrors it in the URL, so a filtered view can be shared.

export interface FilterableCard {
  type: string
  transaction: string
  price: number
  rent: number
  district: string
  city: string
  beds: number
}

export type Deal = 'all' | 'sale' | 'rent'
export type Sort = 'newest' | 'price_asc' | 'price_desc'

export interface Filters {
  deal: Deal
  type: string        // '' = any
  area: string        // '' = any; matches the district or the city
  minPrice: number | null
  maxPrice: number | null
  beds: number        // minimum; 0 = any
  sort: Sort
}

export const NO_FILTERS: Filters = { deal: 'all', type: '', area: '', minPrice: null, maxPrice: null, beds: 0, sort: 'newest' }

const isRent = (c: FilterableCard) => c.transaction === 'For Rent'

/** What the visitor pays: the monthly rent for a rental, the price otherwise. */
export function askingPrice(c: FilterableCard): number {
  return isRent(c) ? Number(c.rent) || 0 : Number(c.price) || 0
}

const norm = (s: string) => String(s ?? '').trim().toLowerCase()

/** The cards that pass the filters, in the chosen order (input order = newest first). */
export function applyFilters<T extends FilterableCard>(cards: T[], f: Filters): T[] {
  const out = cards.filter(c => {
    if (f.deal === 'sale' && isRent(c)) return false
    if (f.deal === 'rent' && !isRent(c)) return false
    if (f.type && norm(c.type) !== norm(f.type)) return false
    if (f.area && norm(c.district) !== norm(f.area) && norm(c.city) !== norm(f.area)) return false
    if (f.beds && (Number(c.beds) || 0) < f.beds) return false
    const p = askingPrice(c)
    // A listing with no price is never hidden by a price range it can't be
    // checked against — "price on request" is still worth seeing.
    if (p > 0 && f.minPrice != null && p < f.minPrice) return false
    if (p > 0 && f.maxPrice != null && p > f.maxPrice) return false
    return true
  })
  if (f.sort === 'newest') return out
  const dir = f.sort === 'price_asc' ? 1 : -1
  // Unpriced listings go last either way.
  return [...out].sort((a, b) => {
    const pa = askingPrice(a), pb = askingPrice(b)
    if (!pa !== !pb) return pa ? -1 : 1
    return (pa - pb) * dir
  })
}

/** The choices worth offering: only types and areas the agency actually has. */
export function filterOptions(cards: FilterableCard[]): { types: string[]; areas: string[]; hasSale: boolean; hasRent: boolean } {
  const types = new Set<string>(), areas = new Set<string>()
  for (const c of cards) {
    if (c.type) types.add(c.type)
    for (const a of [c.district, c.city]) if (a && a.trim()) areas.add(a.trim())
  }
  const byName = (a: string, b: string) => a.localeCompare(b)
  return {
    types: [...types].sort(byName),
    areas: [...areas].sort(byName),
    hasSale: cards.some(c => !isRent(c)),
    hasRent: cards.some(isRent),
  }
}

// ── URL <-> filters, so a filtered view is a link ────────────────────────────

const num = (v: string | null): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function filtersFromQuery(q: URLSearchParams): Filters {
  const deal = q.get('deal')
  const sort = q.get('sort')
  return {
    deal: deal === 'sale' || deal === 'rent' ? deal : 'all',
    type: q.get('type') ?? '',
    area: q.get('area') ?? '',
    minPrice: num(q.get('min')),
    maxPrice: num(q.get('max')),
    beds: Math.min(10, Math.floor(num(q.get('beds')) ?? 0)),
    sort: sort === 'price_asc' || sort === 'price_desc' ? sort : 'newest',
  }
}

export function filtersToQuery(f: Filters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const q = new URLSearchParams(base)
  const set = (k: string, v: string | number | null, unset: string | number | null) =>
    v == null || v === unset || v === '' ? q.delete(k) : q.set(k, String(v))
  set('deal', f.deal, 'all')
  set('type', f.type, '')
  set('area', f.area, '')
  set('min', f.minPrice, null)
  set('max', f.maxPrice, null)
  set('beds', f.beds, 0)
  set('sort', f.sort, 'newest')
  return q
}

export function isFiltered(f: Filters): boolean {
  return f.deal !== 'all' || !!f.type || !!f.area || f.minPrice != null || f.maxPrice != null || f.beds > 0
}
