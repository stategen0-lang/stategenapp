// Writing new-listing alerts to the database.
//
// Kept out of the API route so both listing-creation paths — the web form and
// the WhatsApp bot — can raise alerts through one function.

import type { SupabaseClient } from '@supabase/supabase-js'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'
import { buildAlerts, ALERT_THRESHOLD, MAX_ALERTS_PER_LISTING } from '@/lib/alerts'
import { matchProperties, hasBrief } from '@/lib/matching'
import { priceDropAlerts, askingPrice } from '@/lib/price-drop'
import { companyAreaIndex } from '@/lib/lebanon/company-areas-server'
import { pushToAgents } from '@/lib/push-server'
import { newListingPush, priceDropPush, newClientPush } from '@/lib/push-copy'

/**
 * Send each agent ONE notification about their best match.
 *
 * An agent with four clients who all fit a new listing wants a phone that
 * buzzes once, not four times — and the alert worth naming is the strongest.
 * The in-app list still carries every match; this is only what reaches the
 * lock screen.
 */
async function notifyBest(
  admin: SupabaseClient,
  companyId: number,
  drafts: { agent_code: string | null; score: number; clientName: string }[],
  payloadFor: (d: { agent_code: string | null; score: number; clientName: string }) => ReturnType<typeof newListingPush>,
): Promise<void> {
  const best = new Map<string, typeof drafts[number]>()
  for (const d of drafts) {
    if (!d.agent_code) continue
    const current = best.get(d.agent_code)
    if (!current || d.score > current.score) best.set(d.agent_code, d)
  }
  await Promise.all([...best.entries()].map(([agentCode, d]) =>
    pushToAgents(admin, companyId, [agentCode], payloadFor(d))))
}

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

    // One notification per agent, not one per matched client: an agent with
    // four clients who all fit should get a phone that buzzes once. The best
    // match is the one worth naming.
    await notifyBest(admin, companyId, drafts, d =>
      newListingPush({ listingTitle: property.title, clientName: d.clientName, score: d.score, propertyId: property.id }))

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

    await notifyBest(admin, companyId, drafts, d => priceDropPush({
      listingTitle: property.title, clientName: d.clientName, score: d.score,
      propertyId: property.id, oldPrice, newPrice: askingPrice(property),
    }))

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

/**
 * The other direction: an agent added a CLIENT whose brief fits somebody else's
 * listing, so the listing's agent is told there is a buyer for it.
 *
 * Aimed at the property's agent, not the client's — which is the one thing that
 * makes this different from every other alert in the system, and the reason the
 * alerts feed masks a client's name for anyone who does not own them.
 *
 * Never throws: a client must save whether or not anybody is notified.
 */
export async function createClientAlerts(
  admin: SupabaseClient,
  companyId: number,
  clientRow: Record<string, unknown>,
): Promise<number> {
  try {
    const client = dbRowToClient(clientRow, 0)
    if (!client.id || !hasBrief(client)) return 0

    const { data: rows } = await admin
      .from('Properties')
      .select('*')
      .eq('company_id', companyId)

    const properties = (rows ?? []).map((r, i) => dbRowToProperty(r as Record<string, unknown>, i))
    const ix = await companyAreaIndex(admin, companyId)
    const matches = matchProperties(client, properties, ALERT_THRESHOLD, ix)
      .filter(m => m.property.agentId && m.property.agentId !== client.agentId)
      .slice(0, MAX_ALERTS_PER_LISTING)
    if (!matches.length) return 0

    const insert = matches.map(m => ({
      company_id: companyId,
      property_id: m.property.id,
      client_id: client.id,
      // The LISTING's agent is the one being told.
      agent_code: m.property.agentId,
      score: Math.round(m.score.total),
      reason: 'new_client',
    }))

    const { error } = await admin
      .from('listing_alerts')
      .upsert(insert, { onConflict: 'property_id,client_id', ignoreDuplicates: true })
    if (error) {
      console.error('[alerts] new-client insert failed (run migration 032?)', error)
      return 0
    }

    // One per agent, best listing first — and never naming the client, who
    // belongs to somebody else.
    const best = new Map<string, typeof matches[number]>()
    for (const m of matches) {
      const code = m.property.agentId as string
      const current = best.get(code)
      if (!current || m.score.total > current.score.total) best.set(code, m)
    }
    await Promise.all([...best.entries()].map(([agentCode, m]) =>
      pushToAgents(admin, companyId, [agentCode], newClientPush({
        listingTitle: m.property.title, score: m.score.total, propertyId: m.property.id,
      }))))

    return insert.length
  } catch (err) {
    console.error('[alerts] new-client generation failed', err)
    return 0
  }
}
