// Analytics computed from live pipeline deals.
//
// Pure and dependency-free so every metric is unit-tested against known inputs.
// The Reports page used to show hardcoded numbers ("23 sold", "$618K"); these
// functions replace that with figures derived from the actual deals.

export interface AnalyticsDeal {
  id: string | number
  agent_id: string | null
  stage: string
  outcome: 'won' | 'lost' | null
  value: number
  created_at: string
  stage_changed_at: string | null
  agentCommissionPct?: number   // sale: default 2.5
  companyCommissionPct?: number // sale: default 2.5
  isRental?: boolean            // rentals are commissioned in months of rent, not %
  monthlyRent?: number          // the rent basis for a rental deal
}

export const COMMISSION_AGENT_DEFAULT = 2.5
export const COMMISSION_COMPANY_DEFAULT = 2.5
// Rentals: one month's rent to the agent, one month to the company.
export const RENT_MONTHS_AGENT = 1
export const RENT_MONTHS_COMPANY = 1

/** The commission a won deal earns: agent + company shares (0 for open/lost).
 *  Sales are a % of value (default 2.5% each); rentals are months of rent
 *  (default 1 month each). */
export function dealCommission(d: AnalyticsDeal): { agent: number; company: number; total: number } {
  if (d.outcome !== 'won') return { agent: 0, company: 0, total: 0 }
  let agent: number, company: number
  if (d.isRental) {
    const rent = Number(d.monthlyRent ?? d.value) || 0
    agent = rent * RENT_MONTHS_AGENT
    company = rent * RENT_MONTHS_COMPANY
  } else {
    const v = Number(d.value) || 0
    agent = v * ((d.agentCommissionPct ?? COMMISSION_AGENT_DEFAULT) / 100)
    company = v * ((d.companyCommissionPct ?? COMMISSION_COMPANY_DEFAULT) / 100)
  }
  return { agent: Math.round(agent), company: Math.round(company), total: Math.round(agent + company) }
}

export const STAGES: { id: string; label: string }[] = [
  { id: 'lead',        label: 'Lead' },
  { id: 'contacted',   label: 'Contacted' },
  { id: 'viewing',     label: 'Viewing' },
  { id: 'negotiating', label: 'Negotiating' },
  { id: 'closed',      label: 'Closed' },
]

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// ── Headline summary ────────────────────────────────────────────────────────

export interface Summary {
  total: number
  open: number        // not yet closed
  closed: number
  won: number
  lost: number
  /** won / (won + lost), 0-100, or null when nothing is decided yet. */
  winRate: number | null
  openValue: number   // pipeline still in play
  wonValue: number    // closed-won value
  avgWonValue: number // average size of a won deal
  agentCommission: number   // commission earned by agents on won deals
  companyCommission: number // the company's share on won deals
  totalCommission: number   // agent + company (the agency's gross)
  /** won / all deals, 0-100 — overall lead-to-close conversion. */
  closeRate: number | null
}

export function summarise(deals: AnalyticsDeal[]): Summary {
  let open = 0, closed = 0, won = 0, lost = 0, openValue = 0, wonValue = 0
  let agentCommission = 0, companyCommission = 0
  for (const d of deals) {
    const v = num(d.value)
    if (d.stage === 'closed') closed++
    else { open++; openValue += v }
    if (d.outcome === 'won') {
      won++; wonValue += v
      const c = dealCommission(d)
      agentCommission += c.agent; companyCommission += c.company
    } else if (d.outcome === 'lost') lost++
  }
  const decided = won + lost
  return {
    total: deals.length,
    open, closed, won, lost,
    winRate: decided ? Math.round((won / decided) * 100) : null,
    closeRate: deals.length ? Math.round((won / deals.length) * 100) : null,
    openValue,
    wonValue,
    avgWonValue: won ? Math.round(wonValue / won) : 0,
    agentCommission, companyCommission, totalCommission: agentCommission + companyCommission,
  }
}

// ── Pipeline funnel ─────────────────────────────────────────────────────────
// A snapshot of how many deals sit at each stage right now, with each stage's
// share of the total. Not a cohort funnel — deals move both ways on the board.

export interface FunnelStage {
  id: string
  label: string
  count: number
  value: number
  /** Share of all deals, 0-100. */
  pct: number
}

export function funnel(deals: AnalyticsDeal[]): FunnelStage[] {
  const total = deals.length || 1
  return STAGES.map(s => {
    const inStage = deals.filter(d => d.stage === s.id)
    const value = inStage.reduce((sum, d) => sum + num(d.value), 0)
    return {
      id: s.id,
      label: s.label,
      count: inStage.length,
      value,
      pct: Math.round((inStage.length / total) * 100),
    }
  })
}

// ── Agent leaderboard ───────────────────────────────────────────────────────

export interface AgentStat {
  id: string
  name: string
  total: number
  open: number
  won: number
  lost: number
  winRate: number | null
  wonValue: number
  openValue: number
  commission: number   // the agent's own earned commission (won deals)
  avgDaysToClose: number | null
}

export type RankMetric = 'wonValue' | 'commission' | 'won' | 'openValue'

export function leaderboard(
  deals: AnalyticsDeal[],
  agents: { id: string; name: string }[],
  by: RankMetric = 'wonValue',
): AgentStat[] {
  const stats = agents.map(a => {
    const theirs = deals.filter(d => d.agent_id === a.id)
    const s = summarise(theirs)
    return {
      id: a.id,
      name: a.name,
      total: theirs.length,
      open: s.open,
      won: s.won,
      lost: s.lost,
      winRate: s.winRate,
      wonValue: s.wonValue,
      openValue: s.openValue,
      commission: s.agentCommission,
      avgDaysToClose: avgDaysToClose(theirs),
    }
  })
  // Sort by the chosen metric; open pipeline breaks a tie so a busy agent with
  // no closes yet still ranks above an idle one.
  return stats.sort((a, b) => (b[by] as number) - (a[by] as number) || b.openValue - a.openValue)
}

/** An agent's 1-based rank + team size on a metric — for the private self-view
 *  ("you're #2 of 5"), without exposing other agents' names or figures. */
export function rankOf(
  deals: AnalyticsDeal[],
  agents: { id: string; name: string }[],
  agentId: string,
  by: RankMetric = 'wonValue',
): { rank: number; of: number } | null {
  const ranked = leaderboard(deals, agents, by)
  const i = ranked.findIndex(a => a.id === agentId)
  if (i === -1) return null
  return { rank: i + 1, of: ranked.length }
}

// ── Monthly closed trend ────────────────────────────────────────────────────

export interface MonthPoint {
  key: string     // "2026-07"
  label: string   // "Jul"
  wonCount: number
  wonValue: number
}

/** Won deals grouped by the month they closed, most recent `months` months. */
export function monthlyClosed(deals: AnalyticsDeal[], now: Date = new Date(), months = 6): MonthPoint[] {
  const points: MonthPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    points.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      wonCount: 0,
      wonValue: 0,
    })
  }
  const index = new Map(points.map(p => [p.key, p]))

  for (const d of deals) {
    if (d.outcome !== 'won') continue
    const when = d.stage_changed_at ?? d.created_at
    if (!when) continue
    const dt = new Date(when)
    if (Number.isNaN(dt.getTime())) continue
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const point = index.get(key)
    if (point) { point.wonCount++; point.wonValue += num(d.value) }
  }
  return points
}

/** This-month vs last-month won deals, for the honest KPI deltas. */
export function monthOverMonth(deals: AnalyticsDeal[], now: Date = new Date()): {
  wonThis: number; wonLast: number; valueThis: number; valueLast: number
} {
  const pts = monthlyClosed(deals, now, 2)
  const [last, current] = pts
  return {
    wonThis: current?.wonCount ?? 0,
    wonLast: last?.wonCount ?? 0,
    valueThis: current?.wonValue ?? 0,
    valueLast: last?.wonValue ?? 0,
  }
}

/** Average days from a deal's creation to it being won, or null if none won. */
export function avgDaysToClose(deals: AnalyticsDeal[]): number | null {
  const spans: number[] = []
  for (const d of deals) {
    if (d.outcome !== 'won') continue
    const start = new Date(d.created_at).getTime()
    const end = new Date(d.stage_changed_at ?? d.created_at).getTime()
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue
    spans.push((end - start) / 86_400_000)
  }
  if (!spans.length) return null
  return Math.round(spans.reduce((a, b) => a + b, 0) / spans.length)
}

// ── Inventory (listings) ──────────────────────────────────────────────────────

export interface InvProperty { type: string; transaction: string; status: string; price: number; rent: number }
export interface InventoryStats {
  total: number
  totalValue: number    // sum of sale prices across for-sale listings
  available: number
  reserved: number
  sold: number
  forSale: number
  forRent: number
  avgSalePrice: number
  byType: { type: string; count: number }[]
}

export function inventoryStats(props: InvProperty[]): InventoryStats {
  let totalValue = 0, available = 0, reserved = 0, sold = 0, forSale = 0, forRent = 0, saleSum = 0, saleCount = 0
  const types = new Map<string, number>()
  for (const p of props) {
    const st = (p.status || '').toLowerCase()
    if (st === 'sold' || st === 'rented') sold++
    else if (st === 'reserved') reserved++
    else available++
    if ((p.transaction || '').toLowerCase().includes('rent')) forRent++
    else { forSale++; const v = num(p.price); totalValue += v; if (v) { saleSum += v; saleCount++ } }
    types.set(p.type || 'Other', (types.get(p.type || 'Other') ?? 0) + 1)
  }
  return {
    total: props.length, totalValue, available, reserved, sold, forSale, forRent,
    avgSalePrice: saleCount ? Math.round(saleSum / saleCount) : 0,
    byType: [...types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  }
}

// ── Clients / leads ───────────────────────────────────────────────────────────

export interface ClientLite { type: string; leadScore: number }
export interface ClientStats { total: number; buyers: number; renters: number; hot: number; warm: number; cold: number }

export function clientStats(clients: ClientLite[]): ClientStats {
  let buyers = 0, renters = 0, hot = 0, warm = 0, cold = 0
  for (const c of clients) {
    if ((c.type || '').toLowerCase() === 'renter') renters++; else buyers++
    const s = num(c.leadScore)
    if (s >= 70) hot++; else if (s >= 40) warm++; else cold++
  }
  return { total: clients.length, buyers, renters, hot, warm, cold }
}

// ── Offers / negotiation ──────────────────────────────────────────────────────

export interface NegLite { status: string; amount: number | null; asking?: number | null }
export interface OfferStats {
  total: number
  open: number
  accepted: number
  rejected: number
  winRate: number | null              // accepted / (accepted + rejected)
  avgAcceptedDiscount: number | null  // avg % below asking on accepted deals
}

export function offerStats(negs: NegLite[]): OfferStats {
  let open = 0, accepted = 0, rejected = 0
  const discounts: number[] = []
  for (const n of negs) {
    if (n.status === 'accepted') {
      accepted++
      if (n.amount != null && n.asking && n.asking > 0) discounts.push(((n.asking - n.amount) / n.asking) * 100)
    } else if (n.status === 'rejected') rejected++
    else if (n.status === 'open') open++
  }
  const decided = accepted + rejected
  return {
    total: negs.length, open, accepted, rejected,
    winRate: decided ? Math.round((accepted / decided) * 100) : null,
    avgAcceptedDiscount: discounts.length ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length) : null,
  }
}
