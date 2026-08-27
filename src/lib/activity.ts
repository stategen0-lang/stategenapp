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

/** Newest first, capped. ISO timestamps sort lexicographically. */
export function mergeActivity(items: ActivityItem[], limit = 40): ActivityItem[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit)
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
