import type { SupabaseClient } from '@supabase/supabase-js'

// Move every record owned by / attributed to an agent from one code to another,
// company-scoped. An agent's code is the ownership key across the app, so when a
// manager renames a code we must carry all their records over or they'd orphan.
//
// Column-keyed tables update in one statement; JSON-blob tables (Properties'
// Amenities, client_requests' notes) are read-modify-write per matching row.
// Best-effort per table — a failure in one is logged, not fatal, so a partial
// rename can be re-run safely (already-moved rows simply don't match again).

export interface RecodeCounts {
  properties: number
  clients: number
  deals: number
  events: number
  offers: number
  alerts: number
}

async function recodeJsonColumn(
  admin: SupabaseClient,
  table: string,
  companyId: number,
  idCol: string,
  blobCol: string,
  oldCode: string,
  newCode: string,
): Promise<number> {
  const { data } = await admin.from(table).select(`${idCol}, ${blobCol}`).eq('company_id', companyId)
  let moved = 0
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    let blob: Record<string, unknown>
    try { blob = JSON.parse((row[blobCol] as string) || '{}') } catch { continue }
    let touched = false
    if (blob.agentId === oldCode) { blob.agentId = newCode; touched = true }
    if (blob.referredBy === oldCode) { blob.referredBy = newCode; touched = true }
    if (!touched) continue
    const { error } = await admin.from(table).update({ [blobCol]: JSON.stringify(blob) }).eq(idCol, row[idCol])
    if (!error) moved++
  }
  return moved
}

async function recodeColumn(
  admin: SupabaseClient,
  table: string,
  companyId: number,
  col: string,
  oldCode: string,
  newCode: string,
): Promise<number> {
  const { data, error } = await admin
    .from(table).update({ [col]: newCode })
    .eq('company_id', companyId).eq(col, oldCode)
    .select('id')
  if (error) { console.error(`[recode] ${table}.${col}`, error.message); return 0 }
  return (data ?? []).length
}

export async function reassignAgentCode(
  admin: SupabaseClient,
  companyId: number,
  oldCode: string,
  newCode: string,
): Promise<RecodeCounts> {
  const counts: RecodeCounts = { properties: 0, clients: 0, deals: 0, events: 0, offers: 0, alerts: 0 }
  if (oldCode === newCode) return counts

  try { counts.properties = await recodeJsonColumn(admin, 'Properties', companyId, 'id', 'Amenities', oldCode, newCode) } catch (e) { console.error('[recode] Properties', e) }
  try { counts.clients = await recodeJsonColumn(admin, 'client_requests', companyId, 'id', 'notes', oldCode, newCode) } catch (e) { console.error('[recode] client_requests', e) }
  try { counts.deals = await recodeColumn(admin, 'deals', companyId, 'agent_id', oldCode, newCode) } catch (e) { console.error('[recode] deals', e) }
  try { counts.events = await recodeColumn(admin, 'calendar_events', companyId, 'agent_code', oldCode, newCode) } catch (e) { console.error('[recode] calendar_events', e) }
  try { counts.offers = await recodeColumn(admin, 'offers', companyId, 'created_by', oldCode, newCode) } catch (e) { console.error('[recode] offers', e) }
  try { counts.alerts = await recodeColumn(admin, 'listing_alerts', companyId, 'agent_code', oldCode, newCode) } catch (e) { console.error('[recode] listing_alerts', e) }

  return counts
}
