// Client-side search + filtering for the Properties and Clients lists.
//
// Pure and dependency-free (type-only imports) so the "what matches" logic is
// unit-tested without React or a database. The pages own the filter UI state and
// call these to narrow the already-loaded list.

import type { Property, Client } from '@/lib/data'

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase()
}

// A multi-word query matches when EVERY word appears somewhere in the record —
// so "achrafieh villa" finds a villa in Achrafieh, in any order.
function matchesQuery(haystack: string, q: string): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return true
  return query.split(/\s+/).every(term => haystack.includes(term))
}

export interface PropertyFilters {
  q?: string
  type?: string          // a PropertyType, or '' for any
  transaction?: string   // 'For Sale' | 'For Rent' | ''
  status?: string        // a PropertyStatus, or '' for any
  /**
   * One agent's code, or '' for the whole agency. A manager's filter: an agent
   * has the Mine / All switch, which is the same question asked about
   * themselves, so the picker is only offered to someone who can see everyone.
   */
  agent?: string
  /** Price bounds in USD, inclusive. See listingPrice() for which figure. */
  priceMin?: number
  priceMax?: number
  /** Built size in m², inclusive. */
  sizeMin?: number
  sizeMax?: number
  /** Minimum bedrooms — "3" means 3 or more, the way agents ask for it. */
  bedsMin?: number
}

/**
 * The figure a price filter compares against.
 *
 * A rental's asking figure is its monthly rent, not the (empty) sale price, so
 * comparing both against `price` would make every rental cost nothing and match
 * any budget. Reading each listing in its own terms means a 200k–400k search
 * returns sales and a 500–1,500 search returns rentals, which is how an agent
 * thinks about it anyway.
 */
function listingPrice(p: Property): number {
  return p.transaction === 'For Rent' ? Number(p.rent) || 0 : Number(p.price) || 0
}

/** A bound only applies when it is a real, positive number. */
const bounded = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function filterProperties(list: Property[], f: PropertyFilters): Property[] {
  const priceMin = bounded(f.priceMin), priceMax = bounded(f.priceMax)
  const sizeMin = bounded(f.sizeMin), sizeMax = bounded(f.sizeMax)
  const bedsMin = bounded(f.bedsMin)

  return list.filter(p => {
    if (f.agent && p.agentId !== f.agent) return false
    if (f.type && p.type !== f.type) return false
    if (f.transaction && p.transaction !== f.transaction) return false
    if (f.status && p.status !== f.status) return false

    if (priceMin != null || priceMax != null) {
      const price = listingPrice(p)
      // A listing with no figure on it can't be claimed to be in range. Letting
      // it through would quietly put "price on request" into every search.
      if (!price) return false
      if (priceMin != null && price < priceMin) return false
      if (priceMax != null && price > priceMax) return false
    }

    if (sizeMin != null || sizeMax != null) {
      const size = Number(p.size) || 0
      if (!size) return false            // same reasoning as price
      if (sizeMin != null && size < sizeMin) return false
      if (sizeMax != null && size > sizeMax) return false
    }

    // Land, shops and warehouses have no bedrooms, so asking for 2+ bedrooms
    // correctly excludes them rather than treating 0 as "unknown".
    if (bedsMin != null && (Number(p.beds) || 0) < bedsMin) return false

    const hay = [p.title, p.district, p.city, p.type, p.view, `#${p.id}`].map(norm).join(' ')
    return matchesQuery(hay, f.q ?? '')
  })
}

export interface ClientFilters {
  q?: string
  type?: string    // 'Buyer' | 'Renter' | ''
  status?: string  // a ClientStatus, or '' for any
  /** One agent's code, or '' for the whole agency — managers only. */
  agent?: string
}

export function filterClients(list: Client[], f: ClientFilters): Client[] {
  return list.filter(c => {
    if (f.agent && c.agentId !== f.agent) return false
    if (f.type && c.type !== f.type) return false
    if (f.status && c.status !== f.status) return false
    // Masked (other-agent) clients have a "Client #id" name and no phone, but
    // their location/type are still searchable.
    const hay = [c.name, c.phone, c.req?.location, c.type, `#${c.id}`].map(norm).join(' ')
    return matchesQuery(hay, f.q ?? '')
  })
}
