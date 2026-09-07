import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { loadCompanyRoster } from '@/lib/agent-roster-server'
import { dbRowToProperty, dbRowToClient } from '@/lib/db-mappers'
import { negotiationState, type OfferRound, type OfferSide } from '@/lib/offers'
import {
  summarise, funnel, leaderboard, rankOf, monthlyClosed, monthOverMonth, avgDaysToClose,
  inventoryStats, clientStats, offerStats, dealCommission,
  type AnalyticsDeal, type InvProperty, type ClientLite, type NegLite,
} from '@/lib/analytics'

type Row = Record<string, unknown>

// One trip: everything the analytics center needs, computed server-side and
// scoped by role. A manager sees the whole agency (+ named leaderboard); an
// agent sees only their own figures plus their private rank ("#2 of 5").
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const companyId = session.companyId
  const mgr = isManager(session.role)
  const me = session.agentCode

  const supabaseLike = admin
  const [dealsRes, propsRes, clientsRes, offersRes, roster] = await Promise.all([
    // select('*') so this still works before migration 019 (commission columns);
    // dealCommission falls back to the 2.5/2.5 default when they're absent.
    admin.from('deals').select('*, client_requests("Client Name")').eq('company_id', companyId),
    admin.from('Properties').select('*').eq('company_id', companyId),
    admin.from('client_requests').select('*').eq('company_id', companyId),
    admin.from('offers').select('deal_id, amount, side, status, created_at').eq('company_id', companyId),
    loadCompanyRoster(supabaseLike, companyId),
  ])

  const dealRows = (dealsRes.data ?? []) as Row[]
  const agents = roster.map(a => ({ id: a.id, name: a.name }))

  // ── Deals → AnalyticsDeal (+ keep property/client for offers & the table) ──
  // Per-property: is it a rental, its monthly rent, and its asking (sale price
  // or rent) — used for the rental commission basis and the offers-vs-asking.
  const propInfo = new Map<number, { isRental: boolean; rent: number; asking: number }>()
  const props: InvProperty[] = []
  ;(propsRes.data ?? []).forEach((row, i) => {
    const p = dbRowToProperty(row as Row, i)
    const isRental = p.transaction === 'For Rent'
    propInfo.set(p.id, { isRental, rent: p.rent, asking: isRental ? p.rent : p.price })
    if (!mgr && p.agentId !== me) return
    props.push({ type: p.type, transaction: p.transaction, status: p.status, price: p.price, rent: p.rent })
  })

  const clients: ClientLite[] = []
  ;(clientsRes.data ?? []).forEach((row, i) => {
    const c = dbRowToClient(row as Row, i)
    if (!mgr && c.agentId !== me) return
    clients.push({ type: c.type, leadScore: Number((row as Row).lead_score) || 0 })
  })

  const deals: AnalyticsDeal[] = dealRows.map(d => {
    const info = d.property_id != null ? propInfo.get(d.property_id as number) : undefined
    return {
      id: d.id as string,
      agent_id: (d.agent_id as string) ?? null,
      stage: d.stage as string,
      outcome: (d.outcome as 'won' | 'lost' | null) ?? null,
      value: Number(d.value) || 0,
      created_at: d.created_at as string,
      stage_changed_at: (d.stage_changed_at as string) ?? null,
      agentCommissionPct: d.agent_commission_pct != null ? Number(d.agent_commission_pct) : undefined,
      companyCommissionPct: d.company_commission_pct != null ? Number(d.company_commission_pct) : undefined,
      isRental: info?.isRental ?? false,
      monthlyRent: info?.rent,
    }
  })
  const scopedDeals = mgr ? deals : deals.filter(d => d.agent_id === me)

  // ── Negotiations → offer stats (join asking via deal.property_id) ──
  const propertyOfDeal = new Map<string, number | null>(dealRows.map(d => [d.id as string, (d.property_id as number) ?? null]))
  const roundsByDeal = new Map<string, OfferRound[]>()
  for (const o of (offersRes.data ?? []) as Row[]) {
    const k = o.deal_id as string
    const arr = roundsByDeal.get(k) ?? []
    arr.push({ id: '', amount: Number(o.amount), side: o.side as OfferSide, status: o.status as OfferRound['status'], at: String(o.created_at) })
    roundsByDeal.set(k, arr)
  }
  const negs: NegLite[] = []
  for (const [dealId, rounds] of roundsByDeal) {
    const dealRow = dealRows.find(d => d.id === dealId)
    if (!dealRow) continue
    if (!mgr && dealRow.agent_id !== me) continue
    const st = negotiationState(rounds)
    if (st.count === 0) continue
    const pid = propertyOfDeal.get(dealId)
    negs.push({ status: st.status, amount: st.currentAmount, asking: pid ? (propInfo.get(pid)?.asking ?? null) : null })
  }

  const payload: Record<string, unknown> = {
    scope: mgr ? 'manager' : 'agent',
    summary: summarise(scopedDeals),
    funnel: funnel(scopedDeals),
    monthly: monthlyClosed(scopedDeals),
    mom: monthOverMonth(scopedDeals),
    avgDaysToClose: avgDaysToClose(scopedDeals),
    inventory: inventoryStats(props),
    clients: clientStats(clients),
    offers: offerStats(negs),
  }

  if (mgr) {
    payload.leaderboard = leaderboard(deals, agents, 'wonValue')
    // Editable commission table: closed-won deals, most valuable first.
    const nameOf = new Map(agents.map(a => [a.id, a.name]))
    payload.closedDeals = dealRows
      .filter(d => d.outcome === 'won')
      .map(d => {
        const value = Number(d.value) || 0
        const info = d.property_id != null ? propInfo.get(d.property_id as number) : undefined
        const isRental = info?.isRental ?? false
        const aPct = d.agent_commission_pct != null ? Number(d.agent_commission_pct) : 2.5
        const cPct = d.company_commission_pct != null ? Number(d.company_commission_pct) : 2.5
        const comm = dealCommission({ id: '', agent_id: null, stage: 'closed', outcome: 'won', value, created_at: '', stage_changed_at: null, isRental, monthlyRent: info?.rent, agentCommissionPct: aPct, companyCommissionPct: cPct })
        return {
          id: d.id, value, isRental,
          clientName: ((d.client_requests as Row | null)?.['Client Name'] as string) ?? 'Client',
          agentName: nameOf.get(d.agent_id as string) ?? (d.agent_id as string) ?? '—',
          agentPct: aPct, companyPct: cPct,
          agentCommission: comm.agent, companyCommission: comm.company,
        }
      })
      .sort((a, b) => b.value - a.value)
  } else {
    // Private rank only — never other agents' names or numbers.
    payload.ranks = me
      ? { revenue: rankOf(deals, agents, me, 'wonValue'), commission: rankOf(deals, agents, me, 'commission') }
      : { revenue: null, commission: null }
  }

  return NextResponse.json(payload)
}

// Adjust a deal's commission split (co-broker etc.). Managers only.
// PATCH { dealId, agentPct, companyPct }
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const b = await req.json().catch(() => ({})) as { dealId?: string; agentPct?: number; companyPct?: number }
  const agentPct = Number(b.agentPct), companyPct = Number(b.companyPct)
  if (!b.dealId || !(agentPct >= 0 && agentPct <= 100) || !(companyPct >= 0 && companyPct <= 100)) {
    return NextResponse.json({ error: 'dealId and valid percentages (0–100) are required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('deals')
    .update({ agent_commission_pct: agentPct, company_commission_pct: companyPct })
    .eq('id', b.dealId).eq('company_id', session.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
