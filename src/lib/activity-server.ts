import type { SupabaseClient } from '@supabase/supabase-js'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'
import { listingItem, clientItem, dealMoveItem, offerItem, eventItem, mergeActivity, type ActivityItem } from '@/lib/activity'

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

// ── Per-agent activity report (manager audit over a date range) ────────────────
//
// Everything an agent did in a chosen window: listings + clients added, deal
// stage moves (incl. wins/losses), offers logged, and viewings/meetings put on
// the calendar. Company-scoped; pass agentCode to focus one agent, or omit for
// the whole team. Each source is independent so one failing query never blanks
// the report.

interface ReportOpts {
  companyId: number
  from: string           // ISO — start of window (inclusive)
  to: string             // ISO — end of window (inclusive)
  agentCode?: string | null   // null/undefined = whole company
}

export async function fetchAgentActivity(admin: SupabaseClient, opts: ReportOpts): Promise<ActivityItem[]> {
  const { companyId, from, to, agentCode = null } = opts

  const { data: people } = await admin
    .from('Profiles').select('agent_code, Full_name').eq('company_id', companyId)
  const nameOf = new Map((people ?? []).filter(p => p.agent_code).map(p => [p.agent_code as string, p.Full_name as string]))
  const nameFor = (code: string | null) => (code ? nameOf.get(code) ?? null : null)

  const items: ActivityItem[] = []

  // ── New listings ──
  try {
    const { data } = await admin
      .from('Properties').select('*')
      .eq('company_id', companyId).gte('created_at', from).lte('created_at', to)
    ;(data ?? []).forEach((row, i) => {
      const p = dbRowToProperty(row as Row, i)
      if (agentCode && p.agentId !== agentCode) return
      items.push(listingItem({
        id: p.id, at: String((row as Row).created_at ?? ''),
        title: p.title, where: [p.district, p.city].filter(Boolean).join(', '),
        agentCode: p.agentId ?? null, agentName: nameFor(p.agentId ?? null),
      }))
    })
  } catch { /* skip */ }

  // ── New clients ──
  try {
    const { data } = await admin
      .from('client_requests').select('*')
      .eq('company_id', companyId).gte('created_at', from).lte('created_at', to)
    ;(data ?? []).forEach((row, i) => {
      const c = dbRowToClient(row as Row, i)
      if (agentCode && c.agentId !== agentCode) return
      items.push(clientItem({
        id: c.id, at: String((row as Row).created_at ?? ''),
        name: c.name, where: c.req.location ?? '',
        agentCode: c.agentId ?? null, agentName: nameFor(c.agentId ?? null),
      }))
    })
  } catch { /* skip */ }

  // ── Deal moves ──
  try {
    const { data } = await admin
      .from('stage_history')
      .select('id, changed_at, to_stage, deals!inner(company_id, agent_id, outcome, client_requests("Client Name"))')
      .eq('deals.company_id', companyId).gte('changed_at', from).lte('changed_at', to)
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
  } catch { /* skip */ }

  // ── Offers logged (attributed to whoever logged it: created_by) ──
  try {
    const { data } = await admin
      .from('offers')
      .select('id, amount, side, created_at, created_by, deals(client_requests("Client Name"))')
      .eq('company_id', companyId).gte('created_at', from).lte('created_at', to)
    for (const row of (data ?? []) as Row[]) {
      const code = (row.created_by as string) ?? null
      if (agentCode && code !== agentCode) continue
      const deal = row.deals as Row | null
      const client = deal?.client_requests as Row | null
      items.push(offerItem({
        id: String(row.id), at: String(row.created_at ?? ''),
        amount: Number(row.amount) || 0, side: String(row.side ?? 'buyer'),
        clientName: (client?.['Client Name'] as string) ?? null,
        agentCode: code, agentName: nameFor(code),
      }))
    }
  } catch { /* skip */ }

  // ── Viewings / meetings scheduled (by when they were created) ──
  try {
    const { data } = await admin
      .from('calendar_events')
      .select('id, created_at, kind, title, agent_code')
      .eq('company_id', companyId).gte('created_at', from).lte('created_at', to)
    for (const row of (data ?? []) as Row[]) {
      const code = (row.agent_code as string) ?? null
      if (agentCode && code !== agentCode) continue
      items.push(eventItem({
        id: String(row.id), at: String(row.created_at ?? ''),
        eventKind: String(row.kind ?? 'event'), title: String(row.title ?? 'Event'),
        agentCode: code, agentName: nameFor(code),
      }))
    }
  } catch { /* skip */ }

  // Chronological, newest first; generous cap for a reporting window.
  return mergeActivity(items, 1000)
}
