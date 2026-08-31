import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '@/lib/whatsapp/write-handlers'
import { isManager } from '@/lib/permissions'
import { negotiationState, sideLabel, money, type OfferRound, type OfferSide, type NegotiationState } from '@/lib/offers'

// The DB side of offer tracking: applying an offer action (shared by the
// WhatsApp confirm flow and the web buttons) and reading negotiations back.
// Company-scoped; an agent only ever touches their own deals.

type Row = Record<string, unknown>

/** Who is acting — built from a WhatsApp Profile or a web Session. */
export interface OfferActor { companyId: number; agentCode: string | null; isManager: boolean }

export function actorFromProfile(p: Profile): OfferActor {
  return { companyId: p.company_id, agentCode: p.agent_code, isManager: isManager(p.role) }
}

async function loadOwnedDeal(admin: SupabaseClient, actor: OfferActor, dealId: string): Promise<{ ok: true; deal: Row } | { ok: false; message: string }> {
  const { data: deal } = await admin
    .from('deals').select('id, agent_id, stage, property_id')
    .eq('id', dealId).eq('company_id', actor.companyId).maybeSingle()
  if (!deal) return { ok: false, message: 'That deal no longer exists.' }
  if (!actor.isManager && (deal as Row).agent_id !== actor.agentCode) {
    return { ok: false, message: 'You do not have permission on that deal.' }
  }
  return { ok: true, deal: deal as Row }
}

// ── Core mutations (no permission check — callers do it) ─────────────────────

async function insertRound(admin: SupabaseClient, actor: OfferActor, deal: Row, o: { amount: number; side: OfferSide; note?: string | null; propertyId?: number | null }): Promise<void> {
  if (o.propertyId && deal.property_id !== o.propertyId) {
    await admin.from('deals').update({ property_id: o.propertyId }).eq('id', deal.id)
  }
  await admin.from('offers').insert({
    company_id: actor.companyId, deal_id: deal.id, amount: o.amount, side: o.side,
    status: 'pending', note: o.note ?? null, created_by: actor.agentCode ?? null,
  })
  // First offer pulls the deal into Negotiating (never re-open a closed deal).
  if (deal.stage !== 'negotiating' && deal.stage !== 'closed') {
    await admin.from('deals').update({ stage: 'negotiating' }).eq('id', deal.id)
  }
}

async function settleLatest(admin: SupabaseClient, dealId: string, decision: 'accept' | 'reject'): Promise<{ ok: false; message: string } | { ok: true; amount: number | null }> {
  const { data: rounds } = await admin
    .from('offers').select('id, amount').eq('deal_id', dealId).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1)
  const latest = (rounds ?? [])[0] as Row | undefined
  if (!latest) return { ok: false, message: 'There is no open offer on that deal.' }

  if (decision === 'reject') {
    await admin.from('offers').update({ status: 'rejected' }).eq('id', latest.id as string)
    return { ok: true, amount: null }
  }
  await admin.from('offers').update({ status: 'accepted' }).eq('id', latest.id as string)
  await admin.from('deals').update({ stage: 'closed', outcome: 'won', value: Number(latest.amount) }).eq('id', dealId)
  return { ok: true, amount: Number(latest.amount) }
}

// ── WhatsApp confirm-flow entry (runs after YES) ─────────────────────────────

export async function applyOfferAction(admin: SupabaseClient, profile: Profile, actionType: string, p: { columns: Record<string, unknown>; label: string }): Promise<string> {
  const actor = actorFromProfile(profile)
  const dealId = String(p.columns.dealId ?? '')
  const owned = await loadOwnedDeal(admin, actor, dealId)
  if (!owned.ok) return owned.message

  if (actionType === 'log_offer') {
    const amount = Number(p.columns.amount)
    const side = String(p.columns.side) as OfferSide
    await insertRound(admin, actor, owned.deal, { amount, side, note: (p.columns.note as string) ?? null, propertyId: p.columns.propertyId != null ? Number(p.columns.propertyId) : null })
    return `Logged — ${sideLabel(side)} ${side === 'owner' ? 'counter of ' : 'offer of '}${money(amount)} on ${p.label}.`
  }
  if (actionType === 'accept_offer' || actionType === 'reject_offer') {
    const res = await settleLatest(admin, dealId, actionType === 'accept_offer' ? 'accept' : 'reject')
    if (!res.ok) return res.message
    return actionType === 'accept_offer'
      ? `Accepted — ${p.label} is Closed · Won at ${money(res.amount ?? 0)}. Mark the listing sold when you're ready.`
      : `Rejected the current offer on ${p.label}.`
  }
  return 'Unknown offer action.'
}

// ── Web entry points ─────────────────────────────────────────────────────────

export async function webLogOffer(admin: SupabaseClient, actor: OfferActor, o: { clientId: number; propertyId: number; amount: number; side: OfferSide; note?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const { data: deals } = await admin
    .from('deals').select('id, agent_id, stage, property_id')
    .eq('company_id', actor.companyId).eq('client_id', o.clientId)
    .order('created_at', { ascending: false })
  const deal = (deals ?? [])[0] as Row | undefined
  if (!deal) return { ok: false, error: 'That client has no deal yet.' }
  if (!actor.isManager && deal.agent_id !== actor.agentCode) return { ok: false, error: 'That client belongs to another agent.' }

  await insertRound(admin, actor, deal, { amount: o.amount, side: o.side, note: o.note ?? null, propertyId: o.propertyId })
  return { ok: true }
}

export async function webResolveOffer(admin: SupabaseClient, actor: OfferActor, dealId: string, decision: 'accept' | 'reject'): Promise<{ ok: boolean; error?: string }> {
  const owned = await loadOwnedDeal(admin, actor, dealId)
  if (!owned.ok) return { ok: false, error: owned.message }
  const res = await settleLatest(admin, dealId, decision)
  return res.ok ? { ok: true } : { ok: false, error: res.message }
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

export async function fetchPropertyNegotiations(admin: SupabaseClient, opts: { companyId: number; propertyId: number; agentCode?: string | null }): Promise<PropertyNegotiation[]> {
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

/** Current offer per deal id (for pipeline badges). Only deals with offers. */
export async function fetchDealOfferSummary(admin: SupabaseClient, companyId: number, dealIds: string[]): Promise<Record<string, { amount: number; status: string }>> {
  if (!dealIds.length) return {}
  const { data: offers } = await admin
    .from('offers').select('deal_id, amount, side, status, created_at')
    .eq('company_id', companyId).in('deal_id', dealIds).order('created_at', { ascending: true })

  const byDeal = new Map<string, Row[]>()
  for (const o of (offers ?? []) as Row[]) {
    const k = o.deal_id as string
    const arr = byDeal.get(k) ?? []
    arr.push(o); byDeal.set(k, arr)
  }
  const out: Record<string, { amount: number; status: string }> = {}
  for (const [dealId, rows] of byDeal) {
    const s = negotiationState(roundsOf(rows))
    if (s.currentAmount != null) out[dealId] = { amount: s.currentAmount, status: s.status }
  }
  return out
}
