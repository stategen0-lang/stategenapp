import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '@/lib/whatsapp/write-handlers'
import { isManager } from '@/lib/permissions'
import { negotiationState, sideLabel, money, type OfferRound, type OfferSide, type NegotiationState } from '@/lib/offers'

// The DB side of offer tracking: applying a confirmed offer action, and reading
// negotiations back for the web/WhatsApp views. Company-scoped; an agent only
// ever touches their own deals (a manager, the whole agency).

type Row = Record<string, unknown>

/** Rows an apply/stager passes through the confirm-before-write payload. */
interface OfferPayload { columns: Record<string, unknown>; label: string }

// Runs after the agent confirms. Inserts the round / settles it, and advances
// the deal (first offer → Negotiating; accept → Closed·Won at the amount).
export async function applyOfferAction(
  admin: SupabaseClient, profile: Profile, actionType: string, p: OfferPayload,
): Promise<string> {
  const dealId = String(p.columns.dealId ?? '')
  const { data: deal } = await admin
    .from('deals').select('id, agent_id, stage, property_id')
    .eq('id', dealId).eq('company_id', profile.company_id).maybeSingle()
  if (!deal) return 'That deal no longer exists.'
  if (!isManager(profile.role) && (deal as Row).agent_id !== profile.agent_code) {
    return 'You no longer have permission on that deal.'
  }

  if (actionType === 'log_offer') {
    const amount = Number(p.columns.amount)
    const side = String(p.columns.side) as OfferSide
    const propertyId = p.columns.propertyId != null ? Number(p.columns.propertyId) : null
    if (propertyId && (deal as Row).property_id !== propertyId) {
      await admin.from('deals').update({ property_id: propertyId }).eq('id', dealId)
    }
    const { error } = await admin.from('offers').insert({
      company_id: profile.company_id, deal_id: dealId, amount, side,
      status: 'pending', note: (p.columns.note as string) ?? null, created_by: profile.agent_code ?? null,
    })
    if (error) throw error
    // First offer pulls the deal into Negotiating (never re-open a closed deal).
    if ((deal as Row).stage !== 'negotiating' && (deal as Row).stage !== 'closed') {
      await admin.from('deals').update({ stage: 'negotiating' }).eq('id', dealId)
    }
    return `Logged — ${sideLabel(side)} ${side === 'owner' ? 'counter of ' : 'offer of '}${money(amount)} on ${p.label}.`
  }

  if (actionType === 'accept_offer' || actionType === 'reject_offer') {
    const { data: rounds } = await admin
      .from('offers').select('id, amount').eq('deal_id', dealId).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1)
    const latest = (rounds ?? [])[0] as Row | undefined
    if (!latest) return 'There is no open offer on that deal.'

    if (actionType === 'reject_offer') {
      await admin.from('offers').update({ status: 'rejected' }).eq('id', latest.id as string)
      return `Rejected the current offer on ${p.label}.`
    }
    await admin.from('offers').update({ status: 'accepted' }).eq('id', latest.id as string)
    await admin.from('deals').update({ stage: 'closed', outcome: 'won', value: Number(latest.amount) }).eq('id', dealId)
    return `Accepted — ${p.label} is Closed · Won at ${money(Number(latest.amount))}. Mark the listing sold when you're ready.`
  }

  return 'Unknown offer action.'
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface PropertyNegotiation {
  dealId: string
  clientId: number | null
  clientName: string
  agentCode: string | null
  state: NegotiationState
}

function roundsOf(offers: Row[]): OfferRound[] {
  return offers.map(o => ({
    id: String(o.id), amount: Number(o.amount), side: o.side as OfferSide,
    status: o.status as OfferRound['status'], note: (o.note as string) ?? null,
    at: String(o.created_at), by: (o.created_by as string) ?? null,
  }))
}

/** Every negotiation on a property that has at least one offer. Agent-scoped
 *  when agentCode is given. */
export async function fetchPropertyNegotiations(
  admin: SupabaseClient, opts: { companyId: number; propertyId: number; agentCode?: string | null },
): Promise<PropertyNegotiation[]> {
  const { companyId, propertyId, agentCode = null } = opts
  const { data: deals } = await admin
    .from('deals').select('id, agent_id, client_id, client_requests("Client Name")')
    .eq('company_id', companyId).eq('property_id', propertyId)
  const list = (deals ?? []).filter(d => !agentCode || (d as Row).agent_id === agentCode) as Row[]
  if (!list.length) return []

  const dealIds = list.map(d => d.id as string)
  const { data: offers } = await admin
    .from('offers').select('id, deal_id, amount, side, status, note, created_at, created_by')
    .in('deal_id', dealIds).order('created_at', { ascending: true })

  const byDeal = new Map<string, Row[]>()
  for (const o of (offers ?? []) as Row[]) {
    const k = o.deal_id as string
    const arr = byDeal.get(k) ?? []
    arr.push(o); byDeal.set(k, arr)
  }

  return list.map(d => {
    const client = (d as Row).client_requests as Row | null
    return {
      dealId: d.id as string,
      clientId: ((d as Row).client_id as number) ?? null,
      clientName: (client?.['Client Name'] as string) ?? 'Client',
      agentCode: ((d as Row).agent_id as string) ?? null,
      state: negotiationState(roundsOf(byDeal.get(d.id as string) ?? [])),
    }
  }).filter(n => n.state.count > 0)
}
