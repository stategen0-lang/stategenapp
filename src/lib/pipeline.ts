// Deal pipeline — stages, types and pure helpers.
// Kept free of React/network so it can be unit-tested in isolation.

export type Stage = 'lead' | 'contacted' | 'viewing' | 'negotiating' | 'closed'
export type Outcome = 'won' | 'lost' | null

export const STAGES: { id: Stage; label: string; meaning: string }[] = [
  { id: 'lead',        label: 'Lead',        meaning: 'New client, no contact made yet' },
  { id: 'contacted',   label: 'Contacted',   meaning: 'Agent has reached out, awaiting engagement' },
  { id: 'viewing',     label: 'Viewing',     meaning: 'Client is actively viewing properties' },
  { id: 'negotiating', label: 'Negotiating', meaning: 'Offer or price discussion in progress' },
  { id: 'closed',      label: 'Closed',      meaning: 'Deal done — won or lost' },
]

export const STAGE_IDS: Stage[] = STAGES.map(s => s.id)

export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGE_IDS as string[]).includes(v)
}

// A deal joined with the bits of the client/property the board renders.
export interface Deal {
  id: string
  company_id: number
  client_id: number
  agent_id: string | null
  property_id: number | null
  stage: Stage
  outcome: Outcome
  value: number
  stage_changed_at: string | null
  created_at: string
  clientName: string
  propertyLabel: string | null   // "Appartement · Hamra, Beirut"
}

// ── Days in current stage ────────────────────────────────────────────────────
// Flagged amber over 7 days, red over 14 (per spec).
export function daysInStage(stageChangedAt: string | null, now: Date = new Date()): number {
  if (!stageChangedAt) return 0
  const then = new Date(stageChangedAt).getTime()
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000))
}

export type StaleFlag = 'ok' | 'warn' | 'late'

export function staleFlag(days: number): StaleFlag {
  if (days > 14) return 'late'
  if (days > 7) return 'warn'
  return 'ok'
}

export const STALE_STYLE: Record<StaleFlag, { bg: string; color: string }> = {
  ok:   { bg: '#F0F2F5', color: '#6A7488' },
  warn: { bg: '#FBEFD6', color: '#9A6516' },
  late: { bg: '#FBE7E7', color: '#A23434' },
}

// ── Column aggregates ────────────────────────────────────────────────────────
export function dealsInStage(deals: Deal[], stage: Stage): Deal[] {
  return deals.filter(d => d.stage === stage)
}

export function totalValue(deals: Deal[]): number {
  return deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
}

// Sort hottest-first. Phase 2 will sort by lead score; until that lands we rank
// by deal value so the biggest deals surface at the top of each column.
export function sortForBoard(deals: Deal[]): Deal[] {
  return [...deals].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
}
