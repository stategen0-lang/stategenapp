// Finding existing listings in the database, scaled for thousands of rows.
//
// The database narrows (every search word must appear in the title, area or the
// Amenities JSON; filters on real columns), capped at a few hundred candidates;
// listing-search-core then verifies each against the fields the viewer may
// search, ranks and formats. Migration 024 adds trigram indexes so the
// "contains" searches stay fast as listings grow.
//
// Server-only (admin client).

import type { SupabaseClient } from '@supabase/supabase-js'
import { isManager, owns, type Session } from '@/lib/permissions'
import {
  rankCandidates, searchTerms, phoneQuery, phoneRegex,
  type ListingQuery, type ListingHit, type CandidateRow,
} from '@/lib/listing-search-core'

const CANDIDATE_CAP = 300

export type SearchViewer = Pick<Session, 'companyId' | 'role' | 'agentCode'>

export interface SearchResult {
  hits: ListingHit[]
  /** True when the database had more candidates than were checked. */
  capped: boolean
}

export async function searchListings(admin: SupabaseClient, viewer: SearchViewer, query: ListingQuery): Promise<SearchResult> {
  let q = admin
    .from('Properties')
    .select('id, Title, Location, Neighborhood, Price, Bedrooms, Status, Payment_terms, Amenities')
    .eq('company_id', viewer.companyId)

  // Each word must appear somewhere searchable. Terms are letters/digits only
  // (searchTerms), so they're safe inside the or() filter; * is PostgREST's
  // wildcard there.
  for (const t of searchTerms(query.text)) {
    q = q.or(`Title.ilike.*${t}*,Location.ilike.*${t}*,Neighborhood.ilike.*${t}*,Amenities.ilike.*${t}*`)
  }
  const phone = phoneQuery(query.text)
  if (phone) q = q.filter('Amenities', 'match', phoneRegex(phone))

  if (query.location) {
    // The whole place name, not split into words ("Sin el Fil" must stay intact);
    // stripped to letters/digits/spaces so it's safe inside the filter.
    const loc = query.location.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim()
    if (loc) q = q.or(`Location.ilike.*${loc}*,Neighborhood.ilike.*${loc}*`)
  }
  if (query.type) {
    const type = query.type.replace(/[^\p{L}\s-]/gu, '')
    if (type) q = q.ilike('Amenities', `%"type":"${type}"%`)
  }
  if (query.transaction) q = q.ilike('Amenities', `%"transaction":"${query.transaction}"%`)
  if (query.beds) q = q.eq('Bedrooms', query.beds)
  if (query.minPrice) q = q.gte('Price', query.minPrice)
  if (query.maxPrice) q = q.lte('Price', query.maxPrice)
  if (query.status) q = q.eq('Status', query.status)

  const { data, error } = await q.order('id', { ascending: false }).limit(CANDIDATE_CAP)
  if (error) {
    console.error('[listing-search] query failed', error.message)
    return { hits: [], capped: false }
  }

  const rows = (data ?? []) as CandidateRow[]
  const session = { ...viewer, userId: '', fullName: '', approved: true } as Session
  const hits = rankCandidates(rows, query, (_row, ex) =>
    isManager(viewer.role) || owns(session, (ex.agentId as string) ?? null))
  return { hits, capped: rows.length >= CANDIDATE_CAP }
}
