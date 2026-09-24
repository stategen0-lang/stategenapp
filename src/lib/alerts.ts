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
import type { AreaIndex } from './lebanon/areas-core.ts'

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
  // `ix` carries the agency's own places (migration 030): a listing in an area
  // an agent taught the app must alert just like one in Achrafieh.
  opts: { threshold?: number; max?: number; ix?: AreaIndex | null } = {},
): AlertDraft[] {
  if (property.status === 'Sold') return []
  const threshold = opts.threshold ?? ALERT_THRESHOLD
  const max = opts.max ?? MAX_ALERTS_PER_LISTING

  return matchClients(property, clients, threshold, opts.ix)
    .slice(0, max)
    .map(({ client, score }) => ({
      client_id: client.id,
      agent_code: client.agentId ?? null,
      score: Math.round(score.total),
      clientName: client.name,
    }))
}

// ── Display ──────────────────────────────────────────────────────────────────

/** Why the alert exists. Stored, not inferred — see migration 029. */
export type AlertReason = 'new' | 'price_drop'

export interface AlertView {
  id: string
  score: number
  seen: boolean
  created_at: string
  reason: AlertReason
  /** Price-drop alerts only: what it cost before, and what it costs now. */
  oldPrice?: number | null
  newPrice?: number | null
  isRent?: boolean
  propertyId: number | null
  propertyTitle: string
  propertyLabel: string   // "Villa · Achrafieh, Beirut"
  clientId: number | null
  clientName: string
  clientPhone?: string | null   // to open WhatsApp to the client (agent forwards the listing)
  agentName?: string
}

/** A one-line summary for an alert row. */
export function alertHeadline(a: Pick<AlertView, 'clientName' | 'propertyTitle' | 'score' | 'reason'>): string {
  // A price drop is not "a listing matches your client" — the client has been
  // waiting and something changed. Saying so is the whole point of the alert.
  const verb = a.reason === 'price_drop' ? 'is now in budget for' : 'matches'
  return `${a.propertyTitle} ${verb} ${a.clientName} — ${a.score}%`
}
