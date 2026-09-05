// Team activity feed.
//
// A timeline of what the agency did — new listings, new clients, deal moves.
// Derived from the existing tables (no separate audit log), so it works
// retroactively and needs no write-path changes. This module is the pure part:
// turning already-extracted fields into normalized, sorted feed items and the
// one-line text the WhatsApp bot sends. The DB reads live in activity-server.ts.

export type ActivityKind =
  | 'listing_added'
  | 'client_added'
  | 'deal_moved'
  | 'deal_won'
  | 'deal_lost'
  | 'offer_logged'
  | 'event_scheduled'
  | 'client_referred'

export interface ActivityItem {
  id: string                 // stable, unique key (e.g. "listing:12")
  kind: ActivityKind
  at: string                 // ISO timestamp
  agentCode: string | null
  agentName: string | null   // resolved from agent_code, when known
  summary: string            // "New listing: Raouché Apartment"
  detail: string | null      // secondary line, e.g. "Achrafieh, Beirut"
}

const STAGE_LABEL: Record<string, string> = {
  lead: 'Lead', contacted: 'Contacted', viewing: 'Viewing',
  negotiating: 'Negotiating', closed: 'Closed',
}

export const ACTIVITY_ICON: Record<ActivityKind, string> = {
  listing_added: '🏠',
  client_added: '🧑',
  deal_moved: '📈',
  deal_won: '✅',
  deal_lost: '❌',
  offer_logged: '💰',
  event_scheduled: '📅',
  client_referred: '🔁',
}

/** Human label for each action type — used by the per-agent report summary. */
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  listing_added: 'Listings added',
  client_added: 'Clients added',
  deal_moved: 'Deals advanced',
  deal_won: 'Deals won',
  deal_lost: 'Deals lost',
  offer_logged: 'Offers logged',
  event_scheduled: 'Viewings/meetings',
  client_referred: 'Clients referred',
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

export function listingItem(i: { id: string | number; at: string; title: string; where?: string; agentCode: string | null; agentName: string | null }): ActivityItem {
  return {
    id: `listing:${i.id}`, kind: 'listing_added', at: i.at,
    agentCode: i.agentCode, agentName: i.agentName,
    summary: `New listing: ${i.title}`, detail: i.where || null,
  }
}

export function clientItem(i: { id: string | number; at: string; name: string; where?: string; agentCode: string | null; agentName: string | null }): ActivityItem {
  return {
    id: `client:${i.id}`, kind: 'client_added', at: i.at,
    agentCode: i.agentCode, agentName: i.agentName,
    summary: `New client: ${i.name}`, detail: i.where ? `Looking in ${i.where}` : null,
  }
}

/** A deal stage change. A move to `closed` with a won/lost outcome reads as a
 *  win/loss; any other move reads as "→ Stage". */
export function dealMoveItem(i: {
  id: string; at: string; toStage: string; outcome?: string | null;
  clientName: string; agentCode: string | null; agentName: string | null
}): ActivityItem {
  let kind: ActivityKind = 'deal_moved'
  let summary = `${i.clientName} → ${STAGE_LABEL[i.toStage] ?? i.toStage}`
  if (i.toStage === 'closed' && (i.outcome === 'won' || i.outcome === 'lost')) {
    kind = i.outcome === 'won' ? 'deal_won' : 'deal_lost'
    summary = `Deal ${i.outcome}: ${i.clientName}`
  }
  return { id: `deal:${i.id}`, kind, at: i.at, agentCode: i.agentCode, agentName: i.agentName, summary, detail: null }
}

/** An offer/counter logged on a deal. */
export function offerItem(i: {
  id: string; at: string; amount: number; side: string;
  clientName?: string | null; agentCode: string | null; agentName: string | null
}): ActivityItem {
  const label = i.side === 'owner' ? 'Counter' : 'Offer'
  const amt = fmtMoney(i.amount)
  return {
    id: `offer:${i.id}`, kind: 'offer_logged', at: i.at,
    agentCode: i.agentCode, agentName: i.agentName,
    summary: `${label} logged${amt ? `: ${amt}` : ''}`,
    detail: i.clientName ? `on ${i.clientName}` : null,
  }
}

/** A viewing/meeting/call the agent put on the calendar. */
export function eventItem(i: {
  id: string; at: string; eventKind: string; title: string;
  agentCode: string | null; agentName: string | null
}): ActivityItem {
  const k = (i.eventKind || 'event').replace('_', ' ')
  return {
    id: `event:${i.id}`, kind: 'event_scheduled', at: i.at,
    agentCode: i.agentCode, agentName: i.agentName,
    summary: `Scheduled ${k}: ${i.title}`, detail: null,
  }
}

/** Newest first, capped. ISO timestamps sort lexicographically. */
export function mergeActivity(items: ActivityItem[], limit = 40): ActivityItem[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit)
}

// ── Per-agent report summary ──────────────────────────────────────────────────

export interface AgentActivitySummary {
  agentCode: string | null
  agentName: string
  counts: Record<ActivityKind, number>
  total: number
}

function zeroCounts(): Record<ActivityKind, number> {
  return {
    listing_added: 0, client_added: 0, deal_moved: 0, deal_won: 0, deal_lost: 0,
    offer_logged: 0, event_scheduled: 0, client_referred: 0,
  }
}

/**
 * Roll a flat activity list up into one row per agent, with a count of each
 * action type — the manager's "what did each agent do" scoreboard. Sorted by
 * total activity, busiest first.
 */
export function summarizeByAgent(items: ActivityItem[]): AgentActivitySummary[] {
  const byAgent = new Map<string, AgentActivitySummary>()
  for (const item of items) {
    const key = item.agentCode ?? '—'
    let row = byAgent.get(key)
    if (!row) {
      // Fall back to the raw code (then "Unassigned") so two different unnamed
      // codes don't collapse into one indistinguishable row.
      row = { agentCode: item.agentCode, agentName: item.agentName ?? item.agentCode ?? 'Unassigned', counts: zeroCounts(), total: 0 }
      byAgent.set(key, row)
    }
    row.counts[item.kind] += 1
    row.total += 1
    // A later item may carry the resolved name when an earlier one didn't.
    if (item.agentName) row.agentName = item.agentName
  }
  return [...byAgent.values()].sort((a, b) => b.total - a.total)
}

/** Compact relative age: "just now", "5m", "3h", "2d", or a date. */
export function activityAgo(at: string, now: number = Date.now()): string {
  const diff = now - new Date(at).getTime()
  if (!Number.isFinite(diff)) return ''
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** One line for the WhatsApp bot, e.g. "🏠 New listing: … · Rami · 2h". */
export function activityLine(item: ActivityItem, opts: { withAgent?: boolean; now?: number } = {}): string {
  const who = opts.withAgent && item.agentName ? ` · ${item.agentName}` : ''
  const ago = activityAgo(item.at, opts.now)
  return `${ACTIVITY_ICON[item.kind]} ${item.summary}${who}${ago ? ` · ${ago}` : ''}`
}
