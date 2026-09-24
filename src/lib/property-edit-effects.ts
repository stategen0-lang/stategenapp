// What must happen after a listing is edited, wherever the edit came from.
//
// Two consequences, and both used to depend on which screen the agent used:
//   1. a price or status move is recorded, so the team feed can report what
//      CHANGED and not only what was created;
//   2. a price cut raises alerts for the clients it brings within reach.
//
// The web form did (1) and the WhatsApp bot did neither, which is the kind of
// difference nobody notices until a manager asks why half the price changes are
// missing from the feed. One function, both callers — the same rule as
// marketing-send.ts.
//
// Takes the ADMIN client deliberately: property_history is writable by the
// service role only, so passing a signed-in user's client silently writes
// nothing.
//
// Never throws. A listing saving is what matters; its paperwork is not.

import type { SupabaseClient } from '@supabase/supabase-js'
import { propertyChanges } from '@/lib/property-history'
import { createPriceDropAlerts } from '@/lib/alerts-server'

type Row = Record<string, unknown>

const transactionOf = (row: Row): string => {
  try { return String((JSON.parse((row.Amenities as string) || '{}') as Row).transaction ?? '') } catch { return '' }
}

/** Enough of the old row to tell what moved. The web PATCH reads only these. */
export interface PropertyBefore {
  Price?: unknown
  Status?: unknown
  Amenities?: unknown
}

export async function recordPropertyEdit(
  admin: SupabaseClient,
  companyId: number,
  before: PropertyBefore,
  after: Row,
  agentCode: string | null,
): Promise<void> {
  const oldTxn = transactionOf(before as Row)
  const newTxn = transactionOf(after)
  const oldPrice = Number(before.Price) || 0
  const propertyId = Number(after.id) || 0
  if (!propertyId) return

  // ── 1. The history line ──
  try {
    const changes = propertyChanges(
      { price: oldPrice, status: String(before.Status ?? ''), isRent: oldTxn === 'For Rent' },
      { price: Number(after.Price) || 0, status: String(after.Status ?? ''), isRent: newTxn === 'For Rent' },
    )
    if (changes.length) {
      const { error } = await admin.from('property_history').insert(changes.map(c => ({
        company_id: companyId,
        property_id: propertyId,
        field: c.field,
        old_value: c.old,
        new_value: c.new,
        agent_code: agentCode,
      })))
      if (error) console.error('[properties] history not recorded (run migration 028?)', error)
    }
  } catch (e) {
    console.error('[properties] history not recorded', e)
  }

  // ── 2. The price-drop alerts ──
  // Only when the transaction is unchanged: a listing switched from sale to rent
  // goes from $480,000 to $1,200, which is not a discount.
  if (oldTxn !== newTxn || oldPrice <= 0) return
  try {
    await createPriceDropAlerts(admin, companyId, after, oldPrice)
  } catch { /* already logged inside */ }
}
