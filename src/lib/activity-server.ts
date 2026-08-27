import type { SupabaseClient } from '@supabase/supabase-js'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'
import { listingItem, clientItem, dealMoveItem, mergeActivity, type ActivityItem } from '@/lib/activity'

// Assemble the activity feed from the live tables. Company-scoped; pass an
// agentCode to narrow it to one agent's own listings/clients/deals (an agent
// sees only theirs, a manager sees the whole agency). Each source is fetched
// independently so one failing query never blanks the whole feed.

type Row = Record<string, unknown>

interface Opts {
  companyId: number
  agentCode?: string | null   // null/undefined = whole company (manager)
  limit?: number
}

export async function fetchActivity(admin: SupabaseClient, opts: Opts): Promise<ActivityItem[]> {
  const { companyId, agentCode = null, limit = 40 } = opts
  const per = Math.min(Math.max(limit, 8), 60)

  // agent_code → display name, resolved once.
  const { data: people } = await admin
    .from('Profiles').select('agent_code, Full_name').eq('company_id', companyId)
  const nameOf = new Map((people ?? []).filter(p => p.agent_code).map(p => [p.agent_code as string, p.Full_name as string]))
  const nameFor = (code: string | null) => (code ? nameOf.get(code) ?? null : null)

  const items: ActivityItem[] = []

  // ── New listings ──
  try {
    const { data } = await admin
      .from('Properties').select('*')
      .eq('company_id', companyId).order('created_at', { ascending: false }).limit(per * 2)
    ;(data ?? []).forEach((row, i) => {
      const p = dbRowToProperty(row as Row, i)
      if (agentCode && p.agentId !== agentCode) return
      items.push(listingItem({
        id: p.id, at: String((row as Row).created_at ?? ''),
        title: p.title, where: [p.district, p.city].filter(Boolean).join(', '),
        agentCode: p.agentId ?? null, agentName: nameFor(p.agentId ?? null),
      }))
    })
  } catch { /* skip this source */ }

  // ── New clients ──
  try {
    const { data } = await admin
      .from('client_requests').select('*')
      .eq('company_id', companyId).order('created_at', { ascending: false }).limit(per * 2)
    ;(data ?? []).forEach((row, i) => {
      const c = dbRowToClient(row as Row, i)
      if (agentCode && c.agentId !== agentCode) return
      items.push(clientItem({
        id: c.id, at: String((row as Row).created_at ?? ''),
        name: c.name, where: c.req.location ?? '',
        agentCode: c.agentId ?? null, agentName: nameFor(c.agentId ?? null),
      }))
    })
  } catch { /* skip this source */ }

  // ── Deal moves (stage_history → deals → client name) ──
  try {
    const { data } = await admin
      .from('stage_history')
      .select('id, changed_at, to_stage, deals!inner(company_id, agent_id, outcome, client_requests("Client Name"))')
      .eq('deals.company_id', companyId)
      .order('changed_at', { ascending: false }).limit(per * 2)
    for (const row of (data ?? []) as Row[]) {
      const deal = row.deals as Row | null
      if (!deal) continue
      const code = (deal.agent_id as string) ?? null
      if (agentCode && code !== agentCode) continue
      const client = deal.client_requests as Row | null
      items.push(dealMoveItem({
        id: String(row.id), at: String(row.changed_at ?? ''), toStage: String(row.to_stage ?? ''),
        outcome: (deal.outcome as string) ?? null,
        clientName: (client?.['Client Name'] as string) ?? 'a client',
        agentCode: code, agentName: nameFor(code),
      }))
    }
  } catch { /* skip this source */ }

  return mergeActivity(items, limit)
}
