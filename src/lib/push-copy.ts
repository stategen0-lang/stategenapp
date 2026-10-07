// What a phone notification says.
//
// An agent sees this on a lock screen, in a glance, usually while driving or
// mid-viewing. So each one answers three things and stops: what happened, which
// record, and how good a fit. The body never carries a client's name unless the
// person being notified is allowed to see it — these go to the OTHER agent, and
// a notification is the easiest place in the whole app to leak a name that the
// screens are careful about.
//
// Pure: no imports, so the wording is unit-tested without a push service.

export interface PushPayload {
  title: string
  body: string
  /** Where tapping it should land. */
  url: string
  /** Collapses repeats on the phone: a second alert for the same listing
   *  replaces the first rather than stacking. */
  tag: string
}

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`

/** "87%" — the number an agent decides on. */
const pct = (score: number) => `${Math.round(Number(score) || 0)}%`

/**
 * A listing somebody just added fits a client of yours.
 * The client is yours, so naming them is both safe and the point.
 */
export function newListingPush(o: {
  listingTitle: string
  clientName: string
  score: number
  propertyId: number
}): PushPayload {
  return {
    title: 'New listing matches your client',
    body: `${o.listingTitle} — ${pct(o.score)} match for ${o.clientName}`,
    url: `/properties?open=${o.propertyId}`,
    tag: `listing-${o.propertyId}`,
  }
}

/**
 * A price came down and now reaches a client of yours.
 */
export function priceDropPush(o: {
  listingTitle: string
  clientName: string
  score: number
  propertyId: number
  oldPrice: number
  newPrice: number
}): PushPayload {
  return {
    title: 'Price drop — now in budget',
    body: `${o.listingTitle}: ${money(o.oldPrice)} → ${money(o.newPrice)} — ${pct(o.score)} for ${o.clientName}`,
    url: `/properties?open=${o.propertyId}`,
    tag: `listing-${o.propertyId}`,
  }
}

/**
 * Somebody else's new client is looking for a listing of yours.
 *
 * The client belongs to another agent, so they are NOT named — the listing is,
 * because that is the part the recipient owns and recognises. Finding out who
 * the client is means opening the app, where the usual rules apply.
 */
export function newClientPush(o: {
  listingTitle: string
  score: number
  propertyId: number
}): PushPayload {
  return {
    title: 'A new client matches your listing',
    body: `${o.listingTitle} — ${pct(o.score)} match. Open to see who.`,
    url: `/properties?open=${o.propertyId}`,
    tag: `client-for-${o.propertyId}`,
  }
}
