// Phase 5 — manager-only queries: agent activity and overdue follow-ups.
//
// Refused for agents. The spec grants these to the manager role only, and the
// web app already draws the same line: an agent can't see the whole company's
// pipeline there, so the bot must not become the way around it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isManager } from '@/lib/permissions'
import type { Profile } from '@/lib/whatsapp/write-handlers'

const REFUSAL = 'That report is for managers only.'

interface AgentRow {
  id: string
  agent_code: string | null
  Full_name: string | null
  role: string
}

function ownerOf(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

/** Newest activity-log timestamp across a set of client rows. */
function lastActivity(rows: Record<string, unknown>[]): string | null {
  let newest: string | null = null
  for (const r of rows) {
    try {
      const log = JSON.parse((r.notes as string) || '{}').log
      if (Array.isArray(log)) {
        for (const e of log) {
          if (typeof e?.at === 'string' && (!newest || e.at > newest)) newest = e.at
        }
      }
    } catch { /* skip unreadable rows */ }
  }
  return newest
}

function ago(iso: string | null): string {
  if (!iso) return 'no logged activity'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (!Number.isFinite(days)) return 'no logged activity'
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
}

// ── "how is the team doing" ─────────────────────────────────────────────────
export async function handleAgentActivity(admin: SupabaseClient, profile: Profile): Promise<string> {
  if (!isManager(profile.role)) return REFUSAL

  const { data: profiles } = await admin
    .from('Profiles')
    .select('id, agent_code, Full_name, role')
    .eq('company_id', profile.company_id)

  const { data: rows } = await admin
    .from('client_requests')
    .select('*')
    .eq('company_id', profile.company_id)

  const clients = rows ?? []
  const closed = ['Closed', 'Inactive']

  const nameByCode = new Map(
    (profiles ?? [])
      .filter((p: AgentRow) => p.agent_code)
      .map((p: AgentRow) => [p.agent_code as string, p.Full_name ?? p.agent_code as string]),
  )

  // Group by the codes that actually appear on clients, not just the codes that
  // have a Profile row. Listing only known profiles hid 41 of 53 clients here —
  // a report a manager can't reconcile against the client list is worse than none.
  const codes = new Set<string>([
    ...nameByCode.keys(),
    ...clients.map(c => ownerOf(c)).filter((c): c is string => !!c),
  ])
  if (!codes.size) return 'No agents are set up yet.'

  const lines = [...codes].sort().map(code => {
    const theirs = clients.filter(c => ownerOf(c) === code)
    const active = theirs.filter(c => !closed.includes(String(c.status)))
    const scores = theirs.map(c => Number(c.lead_score) || 0).filter(n => n > 0)
    const avg = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0
    // A code with no Profile row usually means the agent hasn't signed up yet.
    const label = nameByCode.get(code) ?? `${code} (no profile)`
    return `• ${label}: ${theirs.length} clients (${active.length} active)`
      + `${avg ? `, avg score ${avg}` : ''}, last activity ${ago(lastActivity(theirs))}`
  })

  const unassigned = clients.filter(c => !ownerOf(c)).length

  return [
    `Team activity (${codes.size} agents, ${clients.length} clients):`,
    ...lines,
    unassigned ? `\n${unassigned} client${unassigned > 1 ? 's are' : ' is'} unassigned.` : null,
  ].filter(Boolean).join('\n')
}

// ── "what follow-ups are overdue" ───────────────────────────────────────────
export async function handleOverdueReminders(admin: SupabaseClient, profile: Profile): Promise<string> {
  if (!isManager(profile.role)) return REFUSAL

  const today = new Date().toISOString().slice(0, 10)

  const { data: due } = await admin
    .from('reminder_schedule')
    .select('id, profile_id, client_id, due_date, status')
    .eq('company_id', profile.company_id)
    .eq('status', 'pending')
    .lt('due_date', today)
    .order('due_date', { ascending: true })
    .limit(20)

  const overdue = due ?? []
  if (!overdue.length) return 'No overdue follow-ups. Everything is on schedule.'

  // Resolve names in two batched lookups rather than one query per row.
  const profileIds = [...new Set(overdue.map(r => r.profile_id).filter(Boolean))]
  const clientIds = [...new Set(overdue.map(r => Number(r.client_id)).filter(Boolean))]

  const [{ data: profiles }, { data: clients }] = await Promise.all([
    admin.from('Profiles').select('id, Full_name').in('id', profileIds),
    admin.from('client_requests').select('id, "Client Name"').in('id', clientIds),
  ])

  const nameOf = new Map((profiles ?? []).map(p => [p.id, p.Full_name ?? 'Unknown agent']))
  const clientOf = new Map((clients ?? []).map(c => [Number(c.id), c['Client Name'] as string]))

  const lines = overdue.map(r => {
    const days = Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86_400_000)
    return `• ${clientOf.get(Number(r.client_id)) ?? `Client #${r.client_id}`}`
      + ` — ${nameOf.get(r.profile_id) ?? 'unassigned'} — ${days}d overdue`
  })

  return [`${overdue.length} overdue follow-up${overdue.length > 1 ? 's' : ''}:`, ...lines].join('\n')
}
