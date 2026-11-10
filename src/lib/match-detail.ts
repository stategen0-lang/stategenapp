// What the "match details" window is allowed to show.
//
// Tapping an alert (or the phone notification for one) opens the listing and the
// client's request side by side. The client may belong to a colleague — an alert
// aimed at the agent whose LISTING matched — so this is where the same privacy
// rules the rest of the app uses get applied once, in a pure function, instead of
// being re-decided in a route and a component.
//
// Pure: rows in, a trimmed view out. Nothing here touches the database.

import type { Client, Property } from '@/lib/data'
import { dbRowToClient, dbRowToProperty } from '@/lib/db-mappers'
import { canSeeClientPII, maskClient, type Session } from '@/lib/permissions'

type Row = Record<string, unknown>

export interface MatchDetail {
  property: Property
  client: Client
  /** The client's own page is only worth linking to for someone allowed to open it. */
  canOpenClient: boolean
  score: number
  reason: 'new' | 'price_drop'
  oldPrice: number | null
}

/**
 * Build the view for one alert. `alertRow` is the listing_alerts row, already
 * checked to be one this session may see.
 */
export function buildMatchDetail(session: Session, propertyRow: Row, clientRow: Row, alertRow: Row): MatchDetail {
  const full = dbRowToClient(clientRow, 0)
  const showClient = canSeeClientPII(session, full.agentId)

  // A listing's owner and attached paperwork are private to its agent and the
  // managers, and its internal notes are never for a screen like this one.
  const p = dbRowToProperty(propertyRow, 0)
  const property: Property = {
    ...p,
    ownerName: undefined,
    ownerContact: undefined,
    documentPath: undefined,
    documentName: undefined,
    notes: undefined,
    referredBy: undefined,
    marketingSentAt: undefined,
    marketingSentBy: undefined,
  }

  // Closing paperwork and referral details are never part of a match; and for a
  // client who is not yours, even the free-text note can carry a name, so it goes
  // along with the name and phone.
  const base: Client = { ...full, closing: undefined, referredBy: undefined, referredByName: undefined }
  const client: Client = showClient
    ? base
    : maskClient({ ...base, req: { ...base.req, notes: '' }, tags: undefined })

  const reason = alertRow.reason === 'price_drop' ? 'price_drop' : 'new'
  return {
    property,
    client,
    canOpenClient: showClient,
    score: Math.round(Number(alertRow.score) || 0),
    reason,
    oldPrice: reason === 'price_drop' ? Number(alertRow.old_price) || null : null,
  }
}
