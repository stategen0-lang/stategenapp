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
}

export function filterProperties(list: Property[], f: PropertyFilters): Property[] {
  return list.filter(p => {
    if (f.type && p.type !== f.type) return false
    if (f.transaction && p.transaction !== f.transaction) return false
    if (f.status && p.status !== f.status) return false
    const hay = [p.title, p.district, p.city, p.type, p.view, `#${p.id}`].map(norm).join(' ')
    return matchesQuery(hay, f.q ?? '')
  })
}

export interface ClientFilters {
  q?: string
  type?: string    // 'Buyer' | 'Renter' | ''
  status?: string  // a ClientStatus, or '' for any
}

export function filterClients(list: Client[], f: ClientFilters): Client[] {
  return list.filter(c => {
    if (f.type && c.type !== f.type) return false
    if (f.status && c.status !== f.status) return false
    // Masked (other-agent) clients have a "Client #id" name and no phone, but
    // their location/type are still searchable.
    const hay = [c.name, c.phone, c.req?.location, c.type, `#${c.id}`].map(norm).join(' ')
    return matchesQuery(hay, f.q ?? '')
  })
}
