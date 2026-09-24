// Writing new-listing alerts to the database.
//
// Kept out of the API route so both listing-creation paths — the web form and
// the WhatsApp bot — can raise alerts through one function.

import type { SupabaseClient } from '@supabase/supabase-js'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'
import { buildAlerts } from '@/lib/alerts'
import { priceDropAlerts, askingPrice } from '@/lib/price-drop'
import { companyAreaIndex } from '@/lib/lebanon/company-areas-server'

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
    // Including the places this agency taught the app, so a listing in one of
    // them alerts like any other.
    const drafts = buildAlerts(property, clients, { ix: await companyAreaIndex(admin, companyId) })
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

/**
 * Raise alerts for a price cut: the clients who fit the listing now and did not
 * at the old price. Returns how many were written.
 *
 * Never throws, for the same reason as above — an edit must save even if the
 * alerting fails. If migration 029 has not been run the insert is rejected and
 * this logs and returns 0: no price-drop alerts until then, and nothing else
 * breaks.
 */
export async function createPriceDropAlerts(
  admin: SupabaseClient,
  companyId: number,
  propertyRow: Record<string, unknown>,
  oldPrice: number,
): Promise<number> {
  try {
    const property = dbRowToProperty(propertyRow, 0)
    if (!property.id) return 0

    const { data: rows } = await admin
      .from('client_requests')
      .select('*')
      .eq('company_id', companyId)

    const clients = (rows ?? []).map((r, i) => dbRowToClient(r as Record<string, unknown>, i))
    const drafts = priceDropAlerts(property, clients, oldPrice, { ix: await companyAreaIndex(admin, companyId) })
    if (!drafts.length) return 0

    const insert = drafts.map(d => ({
      company_id: companyId,
      property_id: property.id,
      client_id: d.client_id,
      agent_code: d.agent_code,
      score: d.score,
      reason: 'price_drop',
      old_price: oldPrice,
    }))

    // Same guard as new-listing alerts: one row per (listing, client), so a
    // second cut can't stack a second alert on the same pairing.
    const { error } = await admin
      .from('listing_alerts')
      .upsert(insert, { onConflict: 'property_id,client_id', ignoreDuplicates: true })
    if (error) {
      console.error('[alerts] price-drop insert failed (run migration 029?)', error)
      return 0
    }

    return insert.length
  } catch (err) {
    console.error('[alerts] price-drop generation failed', err)
    return 0
  }
}

/** The asking price on a raw Properties row, in the terms the listing is sold in. */
export function rowAskingPrice(row: Record<string, unknown>): number {
  return askingPrice(dbRowToProperty(row, 0))
}
