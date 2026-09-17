// Loading + shaping the three lists the app reads everywhere: listings, clients
// and deals. Moved out of the individual routes so /api/dashboard can return all
// of them in ONE request without a second copy of the masking rules drifting out
// of step with the first.
//
// Every function here applies the same privacy rules as before:
//   • a listing's owner details / private document are stripped for anyone but
//     the listing's agent and managers,
//   • another agent's client keeps its requirements but loses name/phone/email,
//   • an agent only sees their own deals, with other names masked.
//
// Server-only (takes a Supabase client bound to the request).

import type { SupabaseClient } from '@supabase/supabase-js'
import { isManager, owns, canSeeDeal, canSeeClientPII, maskClientName, type Session } from '@/lib/permissions'
import { colorFor, type RosterAgent } from '@/lib/agent-roster'
import { loadCompanyRoster } from '@/lib/agent-roster-server'

type Row = Record<string, unknown>

// ── Listings ────────────────────────────────────────────────────────────────

/** The listing agent's code lives in the property's Amenities JSON. */
export function propertyAgent(row: Row): string | null {
  try { return (JSON.parse((row.Amenities as string) || '{}').agentId as string) ?? null } catch { return null }
}

/**
 * Owner name/contact and the private document are confidential to the listing's
 * own agent and managers. Everyone else in the company shares the inventory but
 * must not receive these — so we strip them from the raw row before it leaves
 * the server, not just hide them in the UI (which the network tab would expose).
 */
export function stripPrivateFields(row: Row, session: Session): Row {
  if (isManager(session.role) || owns(session, propertyAgent(row))) return row
  try {
    const ex = JSON.parse((row.Amenities as string) || '{}')
    delete ex.ownerName; delete ex.ownerContact; delete ex.documentPath; delete ex.documentName; delete ex.mapUrl
    return { ...row, Amenities: JSON.stringify(ex) }
  } catch { return row }
}

export async function loadProperties(supabase: SupabaseClient, session: Session): Promise<Row[]> {
  const { data, error } = await supabase
    .from('Properties')
    .select('*')
    .eq('company_id', session.companyId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => stripPrivateFields(r as Row, session))
}

// ── Clients ─────────────────────────────────────────────────────────────────

/** The owning agent code lives in the client's notes JSON. */
export function clientAgent(row: Row): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

export async function loadClients(supabase: SupabaseClient, session: Session, agentFilterRaw: string | null = null): Promise<Row[]> {
  const { data, error } = await supabase
    .from('client_requests')
    .select('*')
    .eq('company_id', session.companyId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  // Managers may narrow to a single agent; agents are always their own scope.
  const agentFilter = isManager(session.role) ? agentFilterRaw : null

  return (data ?? [])
    .filter(r => !agentFilter || clientAgent(r as Row) === agentFilter)
    .map(r => {
      const row = r as Row
      if (canSeeClientPII(session, clientAgent(row))) return row
      // Another agent's client: keep the requirements (so matching still shows
      // demand) but strip the identifying fields.
      let notes = row.notes
      try {
        const parsed = JSON.parse((row.notes as string) || '{}')
        delete parsed.email
        notes = JSON.stringify(parsed)
      } catch { /* leave as-is */ }
      return {
        ...row,
        'Client Name': maskClientName(Number(row.id)),
        'client phone': null,
        notes,
        masked: true,
      }
    })
}

// ── Deals ───────────────────────────────────────────────────────────────────

// Embed the client (name + lead score) and the property in play so the board
// renders in one trip.
export const DEAL_SELECT =
  '*,client_requests(id,"Client Name",lead_score,agent_rating,notes),Properties(id,Title,Location,Neighborhood,Amenities)'

/** Closing checklist summary read off the client's notes JSON (single source
 *  of truth — written by the client detail modal). */
function closingOf(client: Row | null): { downPayment?: number; downPaymentWaived?: boolean; docLabels: string[] } | null {
  if (!client) return null
  try {
    const c = JSON.parse((client.notes as string) || '{}')?.closing
    if (!c) return null
    const docs = Array.isArray(c.documents) ? c.documents : []
    return {
      downPayment: typeof c.downPayment === 'number' ? c.downPayment : undefined,
      downPaymentWaived: c.downPaymentWaived === true,
      docLabels: docs.map((d: Row) => d.label).filter((l: unknown): l is string => typeof l === 'string'),
    }
  } catch { return null }
}

function propertyLabel(p: Row | null): string | null {
  if (!p) return null
  let type = ''
  try { type = (JSON.parse((p.Amenities as string) || '{}').type as string) || '' } catch {}
  const where = [p.Neighborhood, p.Location].filter(Boolean).join(', ')
  return [type || (p.Title as string), where].filter(Boolean).join(' · ') || null
}

export function toDeal(row: Row) {
  const client = row.client_requests as Row | null
  const prop = row.Properties as Row | null
  return {
    id: row.id,
    company_id: row.company_id,
    client_id: row.client_id,
    agent_id: row.agent_id,
    property_id: row.property_id,
    stage: row.stage,
    outcome: row.outcome,
    value: Number(row.value) || 0,
    stage_changed_at: row.stage_changed_at,
    created_at: row.created_at,
    clientName: (client?.['Client Name'] as string) ?? 'Unknown client',
    propertyLabel: propertyLabel(prop),
    leadScore: Number(client?.lead_score ?? 0),
    agentRating: Number(client?.agent_rating ?? 3),
    closing: closingOf(client),
  }
}

export async function loadDeals(
  supabase: SupabaseClient, session: Session, agentFilterRaw: string | null = null,
): Promise<{ deals: ReturnType<typeof toDeal>[]; agents: RosterAgent[] }> {
  const { data, error } = await supabase
    .from('deals')
    .select(DEAL_SELECT)
    .eq('company_id', session.companyId)
    .order('value', { ascending: false })
  if (error) throw new Error(error.message)

  // Managers see the whole board and may filter to one agent; agents only ever
  // get their own deals, whatever the query string says.
  const agentFilter = isManager(session.role) ? agentFilterRaw : null

  const deals = (data ?? [])
    .filter(r => canSeeDeal(session, (r as Row).agent_id as string, agentFilter))
    .map(r => {
      const deal = toDeal(r as Row)
      // Client name on a card is PII — mask it on other agents' deals. Their
      // closing paperwork is off-limits too.
      if (!canSeeClientPII(session, (r as Row).agent_id as string)) {
        return { ...deal, clientName: maskClientName(deal.client_id as number), masked: true, closing: null }
      }
      return deal
    })

  // The roster a manager can filter by, derived from real data. An agent gets
  // only their own entry — the board draws each card's avatar from the roster,
  // but the rest of the team is not theirs to enumerate.
  let agents: RosterAgent[] = await loadCompanyRoster(supabase, session.companyId)
  if (!isManager(session.role)) agents = agents.filter(a => a.id === session.agentCode)

  return { deals, agents }
}

// ── The company's agents, for avatars and contact ────────────────────────────

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export type AgentMap = Record<string, { name: string; initials: string; color: string; whatsapp: string | null }>

/** Takes an ADMIN client: Profiles is not readable through the user's own client. */
export async function loadAgentMap(admin: SupabaseClient, companyId: number): Promise<AgentMap> {
  const { data } = await admin
    .from('Profiles')
    .select('agent_code, Full_name, whatsapp_number, whatsapp_enabled, role')
    .eq('company_id', companyId)

  const agents: AgentMap = {}
  for (const p of data ?? []) {
    const code = p.agent_code as string | null
    if (!code) continue   // owners/managers own no code-tagged listings
    const name = (p.Full_name as string) || code
    agents[code] = {
      name,
      initials: initialsOf(name),
      color: colorFor(code),
      // Only surface a number an agent can actually be reached on.
      whatsapp: (p.whatsapp_enabled !== false && p.whatsapp_number) ? (p.whatsapp_number as string) : null,
    }
  }
  return agents
}
