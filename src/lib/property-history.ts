// What counts as a change worth recording on a listing.
//
// The activity feed is otherwise built from live tables, so it can only report
// what was created. A price moving and a listing going to Reserved or Sold
// leave no trace once the row is overwritten — and those are the two lines a
// manager actually watches. This decides which edits are worth a history row.
//
// Deliberately narrow: an agent fixing a typo in the title should not fill the
// team's feed. Pure, so `node --test` covers it without a database.

export type HistoryField = 'price' | 'rent' | 'status'

export interface PropertyChange {
  field: HistoryField
  old: string
  new: string
}

export interface PropertySnapshot {
  /** The stored figure — the sale price, or the monthly rent for a rental. */
  price: number
  status: string
  isRent: boolean
}

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * The changes between two versions of a listing.
 *
 * A price appearing for the first time (0 → 250,000) is not a price change —
 * it is the listing being completed, and reporting it as a rise would be a lie.
 * The same goes for a price being cleared.
 */
export function propertyChanges(before: PropertySnapshot, after: PropertySnapshot): PropertyChange[] {
  const out: PropertyChange[] = []

  const oldPrice = money(before.price)
  const newPrice = money(after.price)
  if (oldPrice && newPrice && oldPrice !== newPrice) {
    out.push({
      // A rental's figure is its monthly rent, and the feed says so.
      field: after.isRent ? 'rent' : 'price',
      old: String(oldPrice),
      new: String(newPrice),
    })
  }

  const oldStatus = String(before.status ?? '').trim()
  const newStatus = String(after.status ?? '').trim()
  if (newStatus && oldStatus !== newStatus) {
    out.push({ field: 'status', old: oldStatus, new: newStatus })
  }

  return out
}
