// What must not leave the server on a listing row.
//
// Split out of api-loaders.ts so it can be unit-tested: this is a privacy
// boundary rather than a display choice, and a rule nobody can run in a test is
// a rule that quietly changes. Relative, alias-free imports for the same reason
// (the test runner strips types without resolving "@/").

import { isManager, owns, type Session } from './permissions.ts'

type Row = Record<string, unknown>

/** The listing agent's code lives in the property's Amenities JSON. */
export function propertyAgent(row: Row): string | null {
  try { return (JSON.parse((row.Amenities as string) || '{}').agentId as string) ?? null } catch { return null }
}

/**
 * The fields only the listing's own agent and the managers may receive: the
 * owner's name and number, the private document, the exact map pin, and the
 * internal notes.
 */
export const PRIVATE_LISTING_FIELDS = [
  'ownerName', 'ownerContact', 'documentPath', 'documentName', 'mapUrl', 'notes',
] as const

/**
 * Everyone in the agency shares the inventory, but not these. They are removed
 * from the row itself before it leaves the server, not merely hidden in the UI —
 * which the network tab would expose.
 *
 * Internal notes were the exception until the agency asked for them on the
 * listing sheet: they used to be sent to every agent, which is why the sheet
 * could not show them under a heading promising otherwise. Now the rule and the
 * label agree. The same rule empties the "Internal Notes" column of an export
 * run by an agent who does not own the listing.
 */
export function stripPrivateFields(row: Row, session: Session): Row {
  if (isManager(session.role) || owns(session, propertyAgent(row))) return row
  try {
    const ex = JSON.parse((row.Amenities as string) || '{}')
    for (const field of PRIVATE_LISTING_FIELDS) delete ex[field]
    return { ...row, Amenities: JSON.stringify(ex) }
  } catch { return row }
}
