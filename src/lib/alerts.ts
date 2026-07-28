// New-listing match alerts.
//
// When a property is added, the matching engine already knows which clients
// fit. This turns those matches into alert rows aimed at each client's owning
// agent. Pure, so "who gets alerted and at what score" is unit-tested without a
// database — the DB wiring lives in alerts-server.ts.

import type { Property, Client } from '@/lib/data'
// Relative + .ts: matchClients is a runtime import, and the unit-test runner
// strips types without resolving the "@/" alias (matching.ts itself is
// alias-free, so this loads).
import { matchClients } from './matching.ts'

/** Proactive alerts use a higher bar than the on-screen matcher: a nudge an
 *  agent didn't ask for should be a strong fit, not a maybe. */
export const ALERT_THRESHOLD = 60

/** No more than this many alerts per new listing, so a broadly-appealing
 *  property doesn't bury everyone. Best matches are kept. */
export const MAX_ALERTS_PER_LISTING = 25

export interface AlertDraft {
  client_id: number
  agent_code: string | null
  score: number
  /** Kept for the confirmation/logging path; not stored. */
  clientName: string
}

/**
 * The alerts a new listing should raise: its strong client matches, best first,
 * capped. A sold listing raises none — there's nothing to offer.
 */
export function buildAlerts(
  property: Property,
  clients: Client[],
  opts: { threshold?: number; max?: number } = {},
): AlertDraft[] {
  if (property.status === 'Sold') return []
  const threshold = opts.threshold ?? ALERT_THRESHOLD
  const max = opts.max ?? MAX_ALERTS_PER_LISTING

  return matchClients(property, clients, threshold)
    .slice(0, max)
    .map(({ client, score }) => ({
      client_id: client.id,
      agent_code: client.agentId ?? null,
      score: Math.round(score.total),
      clientName: client.name,
    }))
}

// ── Display ──────────────────────────────────────────────────────────────────

export interface AlertView {
  id: string
  score: number
  seen: boolean
  created_at: string
  propertyId: number | null
  propertyTitle: string
  propertyLabel: string   // "Villa · Achrafieh, Beirut"
  clientId: number | null
  clientName: string
  agentName?: string
}

/** A one-line summary for an alert row. */
export function alertHeadline(a: Pick<AlertView, 'clientName' | 'propertyTitle' | 'score'>): string {
  return `${a.propertyTitle} matches ${a.clientName} — ${a.score}%`
}
