// Finding an existing listing by what an agent remembers about it — the owner's
// name or number, words from the title, the area — across thousands of listings.
//
// The database does the narrowing (listing-search.ts builds the query from
// searchPlan below); this module then verifies each candidate against the fields
// the viewer is ALLOWED to search, ranks them, and formats the reply.
//
// Privacy: an owner's name and phone are private to the listing's agent and
// managers. A term that only matches another agent's owner details must not
// surface that listing — otherwise searching a name would reveal whose property
// it is. So owner fields count only where the viewer may see them.
//
// Pure: no imports with runtime values, so the test runner can load it.

export interface ListingQuery {
  /** Free words: owner name, owner phone, title words, area. */
  text?: string
  location?: string
  type?: string
  transaction?: 'For Sale' | 'For Rent'
  beds?: number
  minPrice?: number
  maxPrice?: number
  status?: string
}

export interface CandidateRow {
  id: number
  Title?: string | null
  Location?: string | null
  Neighborhood?: string | null
  Price?: number | null
  Bedrooms?: number | null
  Status?: string | null
  Payment_terms?: string | null
  Amenities?: string | null
}

export interface ListingHit {
  id: number
  title: string
  area: string
  price: number
  rent: number
  transaction: string
  status: string
  beds: number
  type: string
  /** Only set when the viewer may see it. */
  ownerName?: string
  score: number
}

// Words that describe the request, not the listing.
const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'from', 'with', 'and', 'or', 'my', 'his', 'her', 'their',
  'listing', 'listings', 'property', 'properties', 'prop', 'unit', 'owner', 'owners', 'owned', 'belonging', 'belongs',
  'named', 'called', 'titled', 'find', 'search', 'look', 'looking', 'open', 'edit', 'update', 'change', 'show', 'me',
  'get', 'pull', 'up', 'please', 'pls', 'which', 'what', 'is', 'mr', 'mrs', 'ms', 'madame', 'mme', 'monsieur', 'el', 'al',
])

// Letters (any script), digits, apostrophes and hyphens only — the terms go into
// a PostgREST filter, where commas, parentheses, quotes and wildcards have meaning.
export function searchTerms(text: string | null | undefined): string[] {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\-\s]/gu, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w))
  return [...new Set(words)].slice(0, 5)
}

/** The owner's phone the agent typed, as national digits (no 961 / leading 0). */
export function phoneQuery(text: string | null | undefined): string | null {
  const digits = String(text ?? '').replace(/\D/g, '')
  if (digits.length < 6) return null
  const core = digits.replace(/^(00)?961/, '').replace(/^0/, '')
  return core.length >= 6 ? core : null
}

const nationalDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '').replace(/^(00)?961/, '').replace(/^0/, '')

/**
 * A regex for the phone inside the Amenities JSON, tolerating the separators
 * agents type between digit groups ("03 123 456", "70-123-456"). Uses the last
 * 6 digits, which are enough to pick one number out of thousands.
 */
export function phoneRegex(core: string): string {
  return core.slice(-6).split('').join('[^0-9]{0,2}')
}

/** Everything a listing can be found by, split by who may search it. */
function haystacks(row: CandidateRow, canSeeOwner: boolean) {
  let ex: Record<string, unknown> = {}
  try { ex = JSON.parse(row.Amenities || '{}') } catch { ex = {} }
  const pub = [row.Title, row.Location, row.Neighborhood, ex.type].map(v => String(v ?? '').toLowerCase())
  const ownerName = canSeeOwner ? String(ex.ownerName ?? '').toLowerCase() : ''
  const ownerPhone = canSeeOwner ? nationalDigits(ex.ownerContact) : ''
  return { ex, pub, ownerName, ownerPhone }
}

/**
 * Keep the candidates that genuinely match every term in a field the viewer may
 * search, and rank them: an owner-name or title hit outranks an area hit, and
 * newer listings break ties.
 */
export function rankCandidates(
  rows: CandidateRow[],
  query: ListingQuery,
  canSeeOwner: (row: CandidateRow, ex: Record<string, unknown>) => boolean,
): ListingHit[] {
  const terms = searchTerms(query.text)
  const phone = phoneQuery(query.text)
  const hits: ListingHit[] = []

  for (const row of rows) {
    let ex: Record<string, unknown> = {}
    try { ex = JSON.parse(row.Amenities || '{}') } catch { ex = {} }
    const allowed = canSeeOwner(row, ex)
    const h = haystacks(row, allowed)

    let score = 0
    let ok = true
    for (const t of terms) {
      const inOwner = !!h.ownerName && h.ownerName.includes(t)
      const inTitle = h.pub[0].includes(t)
      const inArea = h.pub[1].includes(t) || h.pub[2].includes(t)
      const inType = h.pub[3].includes(t)
      if (!(inOwner || inTitle || inArea || inType)) { ok = false; break }
      // A whole-word owner match ("khoury", not "khouryan") is the strongest signal.
      if (inOwner) score += new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(h.ownerName) ? 6 : 4
      if (inTitle) score += 3
      if (inArea) score += 2
      if (inType) score += 1
    }
    if (!ok) continue
    if (phone) {
      if (!h.ownerPhone || !h.ownerPhone.endsWith(phone.slice(-6))) continue
      score += 10
    }

    hits.push({
      id: Number(row.id),
      title: String(row.Title ?? `Listing #${row.id}`),
      area: [row.Neighborhood, row.Location].filter(Boolean).join(', '),
      price: Number(row.Price) || 0,
      rent: Number(ex.rent) || 0,
      transaction: String(ex.transaction ?? row.Payment_terms ?? ''),
      status: String(row.Status ?? 'Available'),
      beds: Number(row.Bedrooms) || 0,
      type: String(ex.type ?? ''),
      ownerName: allowed && ex.ownerName ? String(ex.ownerName) : undefined,
      score,
    })
  }

  return hits.sort((a, b) => b.score - a.score || b.id - a.id)
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function hitLine(h: ListingHit): string {
  const price = h.transaction === 'For Rent' ? `${money(h.rent || h.price)}/mo` : money(h.price)
  return [
    `#${h.id} ${h.title}`,
    h.area || null,
    price,
    h.status !== 'Available' ? h.status : null,
    h.ownerName ? `owner ${h.ownerName}` : null,
  ].filter(Boolean).join(' · ')
}

/** A short description of what was searched, for "no listings match …". */
export function describeQuery(q: ListingQuery): string {
  return [
    q.text?.trim() ? `"${q.text.trim()}"` : null,
    q.type || null,
    q.transaction ? q.transaction.toLowerCase() : null,
    q.beds ? `${q.beds} bed` : null,
    q.location ? `in ${q.location}` : null,
    q.maxPrice ? `up to ${money(q.maxPrice)}` : null,
    q.status || null,
  ].filter(Boolean).join(' ') || 'that'
}

/** Does the query have anything to search by at all? */
export function hasCriteria(q: ListingQuery): boolean {
  return !!(searchTerms(q.text).length || phoneQuery(q.text) || q.location || q.type || q.transaction || q.beds || q.minPrice || q.maxPrice || q.status)
}
