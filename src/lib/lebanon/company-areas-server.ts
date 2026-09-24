// The gazetteer as one agency sees it, on the server.
//
// Matching that runs server-side — proactive alerts, the WhatsApp bot — has to
// know the places an agency taught the app, or an agent pins "Hbous", sees it
// in the form, and then wonders why no client ever matches it.
//
// One process answers for every agency, so each gets its OWN index and the
// shared one is never touched. Built indexes are cached briefly: a listing
// saved in a burst would otherwise re-read and re-copy the maps for each one.
//
// Never throws. Without the table (migration 030) or on any error this returns
// the plain gazetteer, which is exactly how the app behaved before.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAreas } from './areas.ts'
import { extendIndex, type AreaIndex } from './areas-core.ts'
import { learnedAreas, type LearnedAreaRow } from './learned-areas.ts'

/** Long enough to cover a burst of saves, short enough that a new pin appears
 *  in matching within the minute. */
const TTL_MS = 60_000

const cache = new Map<number, { ix: AreaIndex; at: number }>()

export async function companyAreaIndex(
  admin: SupabaseClient,
  companyId: number,
  now = Date.now(),
): Promise<AreaIndex> {
  const base = await loadAreas()

  const hit = cache.get(companyId)
  if (hit && now - hit.at < TTL_MS) return hit.ix

  try {
    const { data, error } = await admin
      .from('company_areas')
      .select('name, lat, lng, caza, governorate')
      .eq('company_id', companyId)
    if (error) return base

    const ix = extendIndex(base, learnedAreas((data ?? []) as LearnedAreaRow[]))
    cache.set(companyId, { ix, at: now })
    return ix
  } catch {
    return base
  }
}

/** Drop a company's cached index — called when it learns a new place. */
export function forgetCompanyAreaIndex(companyId?: number): void {
  if (companyId === undefined) cache.clear()
  else cache.delete(companyId)
}
