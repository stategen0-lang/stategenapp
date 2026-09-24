// Price-drop alerts: when a listing gets cheaper, who can now afford it?
//
// A price cut is the highest-intent moment in the whole system and it used to
// pass in silence — the row was overwritten and nobody was told. The matching
// engine already knows who fits; all this adds is the comparison.
//
// The rule is deliberately narrow: alert only the clients who did NOT match at
// the old price and DO at the new one. An agent whose client already matched has
// already been told about this listing, and telling them again every time the
// owner shaves $2,000 off is how a notification list gets ignored. So the alert
// means one specific thing — "this is newly within reach" — and an agent can
// trust it without opening it.
//
// Pure, so "who gets alerted" is unit-tested without a database. The DB wiring
// lives in alerts-server.ts.

import type { Property, Client } from '@/lib/data'
// Relative + .ts for the same reason as alerts.ts: these are runtime imports and
// the test runner strips types without resolving the "@/" alias.
import { matchClients } from './matching.ts'
import { ALERT_THRESHOLD, MAX_ALERTS_PER_LISTING, type AlertDraft } from './alerts.ts'
import { dropPercent } from './price-drop-format.ts'

// Re-exported so callers that already have this module don't need both, while
// the alerts page can import the formatting alone.
export { dropPercent, dropLine } from './price-drop-format.ts'

/**
 * Below this, a cut is not news. Owners round their asking price down by a
 * thousand dollars all the time, and a listing that alerts on every nudge is a
 * listing agents learn to scroll past.
 */
export const MIN_DROP_PCT = 3

/** The figure a listing is judged on: rent for a rental, price for a sale. */
export function askingPrice(p: Pick<Property, 'transaction' | 'price' | 'rent'>): number {
  return p.transaction === 'For Rent' ? Number(p.rent) || 0 : Number(p.price) || 0
}

/**
 * Worth telling anyone about? A price that fell to zero is not a discount — it
 * is "price on request", an agent clearing the field — so it raises nothing.
 */
export function isMeaningfulDrop(oldPrice: number, newPrice: number): boolean {
  return dropPercent(oldPrice, newPrice) >= MIN_DROP_PCT
}

/** The same listing as it was before the cut, so it can be re-matched. */
function atPrice(property: Property, price: number): Property {
  return property.transaction === 'For Rent'
    ? { ...property, rent: price }
    : { ...property, price }
}

/**
 * The alerts a price cut should raise: clients who fit the listing now and did
 * not fit it at the old price, best match first, capped like any other alert.
 *
 * Returns nothing when the drop is too small to mention, when the price went up,
 * or when the listing is sold — a sold listing is not on offer to anybody.
 */
export function priceDropAlerts(
  property: Property,
  clients: Client[],
  oldPrice: number,
  opts: { threshold?: number; max?: number } = {},
): AlertDraft[] {
  if (property.status === 'Sold') return []
  const newPrice = askingPrice(property)
  if (!isMeaningfulDrop(oldPrice, newPrice)) return []

  const threshold = opts.threshold ?? ALERT_THRESHOLD
  const max = opts.max ?? MAX_ALERTS_PER_LISTING

  // Everyone the listing already suited, at the price it already had.
  const before = new Set(matchClients(atPrice(property, oldPrice), clients, threshold).map(m => m.client.id))

  return matchClients(property, clients, threshold)
    .filter(m => !before.has(m.client.id))
    .slice(0, max)
    .map(({ client, score }) => ({
      client_id: client.id,
      agent_code: client.agentId ?? null,
      score: Math.round(score.total),
      clientName: client.name,
    }))
}
