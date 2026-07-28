// Writing new-listing alerts to the database.
//
// Kept out of the API route so both listing-creation paths — the web form and
// the WhatsApp bot — can raise alerts through one function.

import type { SupabaseClient } from '@supabase/supabase-js'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'
import { buildAlerts } from '@/lib/alerts'

/**
 * Raise match alerts for a freshly-created property row. Returns how many were
 * written. Never throws — a listing must still save even if alerting fails.
 */
export async function createListingAlerts(
  admin: SupabaseClient,
  companyId: number,
  propertyRow: Record<string, unknown>,
): Promise<number> {
  try {
    const property = dbRowToProperty(propertyRow, 0)
    if (!property.id) return 0

    const { data: rows } = await admin
      .from('client_requests')
      .select('*')
      .eq('company_id', companyId)

    const clients = (rows ?? []).map((r, i) => dbRowToClient(r as Record<string, unknown>, i))
    const drafts = buildAlerts(property, clients)
    if (!drafts.length) return 0

    const insert = drafts.map(d => ({
      company_id: companyId,
      property_id: property.id,
      client_id: d.client_id,
      agent_code: d.agent_code,
      score: d.score,
    }))

    // Ignore duplicates so re-saving a listing doesn't double-alert.
    const { error } = await admin
      .from('listing_alerts')
      .upsert(insert, { onConflict: 'property_id,client_id', ignoreDuplicates: true })
    if (error) { console.error('[alerts] insert failed', error); return 0 }

    return insert.length
  } catch (err) {
    console.error('[alerts] generation failed', err)
    return 0
  }
}
