// Lightweight duplicate detection for clients and properties.
//
// Pure and structurally typed (no app/DB imports) so it unit-tests in isolation
// and runs identically on the server (the /check endpoints) and, if ever needed,
// the client. The goal is a *warning*, not a hard block — real estate has
// genuine near-duplicates (two units in one building), so the UI lets the user
// save anyway after seeing the match.

/** Reduce a phone to its bare subscriber digits so the same Lebanese number
 *  written different ways compares equal. The local leading "0" is what the
 *  country code replaces, so strip an international prefix (00 / 961) AND a
 *  leading 0: "+961 3 221 904", "03 221 904", "961 3 221904", "00961 3 221 904"
 *  all reduce to "3221904". */
export function normalizePhone(raw: string | null | undefined): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('961')) d = d.slice(3)
  return d.replace(/^0+/, '')
}

function normText(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface ClientLike { id: number; name: string; phone: string }

/** Existing clients that look like the candidate: same phone (strongest) or an
 *  exact name match. `selfId` excludes the row being edited. */
export function findClientDupes<T extends ClientLike>(
  cand: { name: string; phone: string },
  existing: readonly T[],
  selfId?: number,
): T[] {
  const p = normalizePhone(cand.phone)
  const n = normText(cand.name)
  return existing.filter(c => {
    if (selfId != null && c.id === selfId) return false
    if (p.length >= 6 && normalizePhone(c.phone) === p) return true
    if (n.length >= 3 && normText(c.name) === n) return true
    return false
  })
}

export interface PropertyLike {
  id: number; title: string; district: string; city: string
  type: string; transaction: string; price: number; rent: number
}

/** Existing properties that look like the candidate: same non-trivial title, or
 *  same location + type at the same price/rent (both non-zero). */
export function findPropertyDupes<T extends PropertyLike>(
  cand: Omit<PropertyLike, 'id'>,
  existing: readonly T[],
  selfId?: number,
): T[] {
  const title = normText(cand.title)
  const candLoc = normText(cand.district) && normText(cand.type)
    ? `${normText(cand.district)}|${normText(cand.city)}|${normText(cand.type)}`
    : ''
  const candAmt = cand.transaction === 'For Rent' ? cand.rent : cand.price
  return existing.filter(p => {
    if (selfId != null && p.id === selfId) return false
    if (title.length >= 4 && normText(p.title) === title) return true
    if (candLoc) {
      const loc = `${normText(p.district)}|${normText(p.city)}|${normText(p.type)}`
      const amt = p.transaction === 'For Rent' ? p.rent : p.price
      if (loc === candLoc && candAmt > 0 && amt === candAmt) return true
    }
    return false
  })
}
