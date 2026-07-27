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
}

export function summarise(deals: AnalyticsDeal[]): Summary {
  let open = 0, closed = 0, won = 0, lost = 0, openValue = 0, wonValue = 0
  for (const d of deals) {
    const v = num(d.value)
    if (d.stage === 'closed') closed++
    else { open++; openValue += v }
    if (d.outcome === 'won') { won++; wonValue += v }
    else if (d.outcome === 'lost') lost++
  }
  const decided = won + lost
  return {
    total: deals.length,
    open, closed, won, lost,
    winRate: decided ? Math.round((won / decided) * 100) : null,
    openValue,
    wonValue,
    avgWonValue: won ? Math.round(wonValue / won) : 0,
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
}

export function leaderboard(
  deals: AnalyticsDeal[],
  agents: { id: string; name: string }[],
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
    }
  })
  // Best closer first; open pipeline breaks a tie so a busy agent with no
  // closes yet still ranks above an idle one.
  return stats.sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue)
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
