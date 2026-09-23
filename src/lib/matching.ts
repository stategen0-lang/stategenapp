// ── Property ⇄ Client matching algorithm ─────────────────────────────────────
// Pure, deterministic scoring shared by the UI (MatchCards) and unit tests.
// No React / DOM / network here so it can be tested in isolation.

import type { Property, Client } from '@/lib/data'
// Relative, not aliased: this module is unit-tested by `node --test`, which
// does not know the "@/" alias. Only the tiny loader is imported — the 53 KB
// of place data stays behind its dynamic import.
import {
  loadedAreas, resolveArea, resolveRegion, governorateOf, distanceKm,
  type Area, type AreaIndex, type RegionMatch,
} from './lebanon/areas.ts'

// Lebanese geography. same zone = 60, adjacent zones = 35, both-known-but-far = 15.
export const ZONES: Record<string, string[]> = {
  beirut:   ['hamra', 'raouche', 'raouché', 'ashrafieh', 'achrafieh', 'gemmayzeh', 'verdun',
             'mar mikhael', 'monot', 'badaro', 'koraytem', 'mazraa', 'jnah', 'sanayeh',
             'sodeco', 'furn el chebbak', 'sin el fil', 'bourj hammoud', 'dekwaneh'],
  metn:     ['naccache', 'dbayeh', 'antelias', 'zalka', 'jal el dib', 'beit mery', 'broumana',
             'mtayleb', 'baabda', 'mansourieh', 'biyada', 'bikfaya', 'ain saade', 'rabieh'],
  keserwan: ['jounieh', 'kaslik', 'ghazir', 'zouk', 'adma', 'tabarja', 'jbeil', 'byblos'],
  chouf:    ['aley', 'bhamdoun', 'barouk', 'deir el qamar', 'damour'],
  north:    ['tripoli', 'zgharta', 'bcharre', 'koura', 'batroun', 'jbeil'],
  south:    ['sidon', 'saida', 'tyre', 'sour', 'nabatieh'],
  bekaa:    ['zahle', 'chtaura', 'baalbek', 'anjar'],
}

// Neighbouring zone pairs — score 35 instead of 0.
export const NEIGHBOURS: [string, string][] = [
  ['beirut', 'metn'],
  ['beirut', 'chouf'],
  ['metn',   'keserwan'],
  ['metn',   'chouf'],
]

export function norm(s: string): string { return (s ?? '').toLowerCase().trim() }

export function propFeatures(p: Property): string[] {
  const out: string[] = []
  if (p.garden)  out.push('garden')
  if (p.balcony) out.push('balcony')
  if (p.view && p.view !== 'Street') out.push(`${p.view.toLowerCase()} view`)
  if (p.terrace) out.push('terrace')
  if ((p.parkings ?? 0) > 0) out.push('parking')
  // Prefixed so one name can't match inside another ("pool" is not "shared pool").
  for (const a of p.amenities ?? []) out.push(`unit:${norm(a)}`)
  for (const b of p.buildingFeatures ?? []) out.push(`building:${norm(b)}`)
  return out
}

// Sentinel returned by scoreBudget when the price is too far from budget to
// recommend at all (more than ±50% off).
export const BUDGET_EXCLUDE = -1

// Budget: symmetric band scoring around the client's single budget figure.
// Deviation = |price − budget| / budget (same whether over OR under):
// ≤10% → 100, ≤20% → 80, ≤30% → 50, ≤50% → 25, beyond ±50% → BUDGET_EXCLUDE.
export function scoreBudget(propPrice: number, budget: number): number {
  if (!budget) return 100                     // no budget given → no constraint
  const dev = Math.abs(propPrice - budget) / budget
  if (dev <= 0.10) return 100
  if (dev <= 0.20) return 80
  if (dev <= 0.30) return 50
  if (dev <= 0.50) return 25
  return BUDGET_EXCLUDE
}

// Sentinel: location too far from the client's preferred area to recommend.
export const LOCATION_EXCLUDE = -1

/** Next door: Achrafieh to Hamra, Jounieh to Kaslik. */
export const NEXT_DOOR_KM = 8
/** Still worth showing: Beirut to Dbayeh, Jounieh to Jbeil. Beyond it, excluded. */
export const SURROUNDING_KM = 20

/**
 * Find the area a stored location string refers to.
 *
 * Listings store the area in one field and older rows in two, joined for
 * scoring, so "Achrafieh, Beirut" has to resolve to Achrafieh — the whole
 * string is not the name of anywhere. Each comma-separated part is tried in
 * turn, most specific first.
 */
function locate(ix: AreaIndex, text: string): Area | null {
  // CONFIDENT matches only. The fuzzy fallback is there to offer an agent a
  // suggestion in a dropdown; letting it decide a match means a guessed village
  // silently excludes every listing a client should have seen.
  const whole = resolveArea(ix, text)
  if (whole?.confident) return whole.area
  for (const part of String(text ?? '').split(',')) {
    const hit = resolveArea(ix, part.trim())
    if (hit?.confident) return hit.area
  }
  return null
}

/**
 * The region a location string names, if it names one rather than a place.
 *
 * A caza that is also a town — Jbeil, Aley, Zahle, Baabda — is treated as the
 * TOWN, because that is what an agent typing it means; Aaqoura is 30 km from
 * Jbeil and should not score as an exact hit. A caza that is only a region
 * (Metn, Keserwan, Chouf) and any governorate are treated as the region.
 */
function region(ix: AreaIndex, text: string, place: Area | null): RegionMatch | null {
  const r = resolveRegion(ix, text)
  if (!r) return null
  // A governorate is always a region. A caza that is also a town is not:
  // "Jbeil" means the town, and Aaqoura 30 km up the mountain is not an exact
  // hit just because it shares the caza.
  if (r.kind === 'caza' && place) return null
  return r
}

/** Is this place inside that region? */
function inside(ix: AreaIndex, area: Area, r: RegionMatch): boolean {
  return r.kind === 'caza' ? area.caza === r.name : area.governorate === r.name
}

/** The governorate a region sits in. */
function govOf(ix: AreaIndex, r: RegionMatch): string {
  return r.kind === 'governorate' ? r.name : governorateOf(ix, r.name)
}

// The areas that make up a region, worked out once per region per index —
// scoring a hundred listings would otherwise walk all 3,600 areas each time.
const members = new WeakMap<AreaIndex, Map<string, Area[]>>()
function areasOf(ix: AreaIndex, r: RegionMatch): Area[] {
  let byRegion = members.get(ix)
  if (!byRegion) { byRegion = new Map(); members.set(ix, byRegion) }
  const key = `${r.kind}:${r.name}`
  let list = byRegion.get(key)
  if (!list) {
    list = ix.areas.filter(a => (r.kind === 'caza' ? a.caza : a.governorate) === r.name)
    byRegion.set(key, list)
  }
  return list
}

/**
 * How far a place is from the nearest edge of a region — not from its middle.
 *
 * Distance to a centroid is the wrong measure for a caza that runs from the
 * coast into the mountains: Achrafieh is a few minutes from the Metn at Sin el
 * Fil, but 20 km from the Metn's centre of gravity up at Bikfaya.
 */
const regionDistance = new WeakMap<AreaIndex, Map<string, number>>()

function kmToRegion(ix: AreaIndex, area: Area, r: RegionMatch): number {
  // Memoised per place-and-region. Scoring one listing against a thousand
  // clients asks the same question a thousand times — the listing never moves,
  // and a caza the size of the Metn holds 300 areas to measure against.
  let cache = regionDistance.get(ix)
  if (!cache) { cache = new Map(); regionDistance.set(ix, cache) }
  const key = `${area.slug}|${r.kind}:${r.name}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let best = Infinity
  for (const a of areasOf(ix, r)) {
    const d = distanceKm(area, a)
    if (d < best) best = d
  }
  cache.set(key, best)
  return best
}

/** Score a listing against a region the client named. */
function scoreRegion(ix: AreaIndex, propLoc: string, propArea: Area | null, r: RegionMatch): number | null {
  const area = propArea ?? locate(ix, propLoc)
  if (area) {
    if (inside(ix, area, r)) return 100
    const km = kmToRegion(ix, area, r)
    if (km <= NEXT_DOOR_KM) return 85
    if (km <= SURROUNDING_KM) return 75
    return LOCATION_EXCLUDE
  }
  // The listing's own area is a region too ("a flat in the Metn").
  const pr = resolveRegion(ix, propLoc)
  if (pr) {
    if (pr.kind === r.kind && pr.name === r.name) return 100
    const a = govOf(ix, pr), b = govOf(ix, r)
    return a && b && a === b ? 75 : LOCATION_EXCLUDE
  }
  return null   // unplaceable → let the caller fall back
}

/**
 * Location: the exact area requested → 100, next door → 85, within the
 * surrounding area → 75, anything further → LOCATION_EXCLUDE.
 *
 * Measured between the two areas' real coordinates. The hand-kept ZONES table
 * below is the fallback for text the gazetteer cannot place ("behind the old
 * mill road"), and for callers that have not loaded it; distance is both more
 * accurate and self-maintaining — the table had Beirut neighbouring the Chouf,
 * which let a listing 35 km up the mountain count as surrounding.
 */
export function scoreLocation(
  propLoc: string,
  clientLoc: string,
  ix: AreaIndex | null = loadedAreas(),
): number {
  if (!clientLoc) return 100                       // no preference → no constraint
  const p = norm(propLoc); const c = norm(clientLoc)
  // A listing with no area at all cannot be claimed to be in the client's:
  // "".includes() is true of everything, which used to score it a perfect 100
  // against every client alive.
  if (!p) return LOCATION_EXCLUDE
  if (p.includes(c) || c.includes(p)) return 100   // exact area requested

  if (ix) {
    const pa = locate(ix, propLoc)
    const ca = locate(ix, clientLoc)

    // A region on either side is answered by containment, not by distance to a
    // point: "Metn" means anywhere in the Metn, not within 20 km of its middle.
    const cRegion = region(ix, clientLoc, ca)
    if (cRegion) {
      const score = scoreRegion(ix, propLoc, pa, cRegion)
      if (score !== null) return score
    } else {
      const pRegion = region(ix, propLoc, pa)
      if (pRegion && ca) {
        if (inside(ix, ca, pRegion)) return 100
        const km = kmToRegion(ix, ca, pRegion)
        if (km <= NEXT_DOOR_KM) return 85
        return km <= SURROUNDING_KM ? 75 : LOCATION_EXCLUDE
      }
    }

    // Both placed: the spelling each was written in no longer matters, which
    // is the whole point — Hazmieh and Hazmiyeh are one place now.
    if (pa && ca) {
      if (pa.slug === ca.slug) return 100
      const km = distanceKm(pa, ca)
      if (km <= NEXT_DOOR_KM) return 85
      if (km <= SURROUNDING_KM) return 75
      return LOCATION_EXCLUDE
    }
  }

  const pZone = Object.entries(ZONES).find(([zone, areas]) => p.includes(zone) || areas.some(a => p.includes(a)))?.[0]
  const cZone = Object.entries(ZONES).find(([zone, areas]) => c.includes(zone) || areas.some(a => c.includes(a)))?.[0]

  // Same region (different district) or a neighbouring region → surrounding.
  if (pZone && cZone && (pZone === cZone
      || NEIGHBOURS.some(([a, b]) => (a === pZone && b === cZone) || (b === pZone && a === cZone)))) return 75
  return LOCATION_EXCLUDE
}

// A client's areas: the explicit list when present, else the single location.
// Scores the property against each and keeps the best (an exact hit in any one
// requested area should win). No areas at all → no constraint.
export function scoreLocationMulti(
  propLoc: string,
  req: { location: string; locations?: string[] },
  ix: AreaIndex | null = loadedAreas(),
): number {
  const areas = (req.locations && req.locations.length ? req.locations : [req.location])
    .map(norm).filter(Boolean)
  if (!areas.length) return 100
  return Math.max(...areas.map(a => scoreLocation(propLoc, a, ix)))
}

export function scoreBedrooms(propBeds: number, clientBeds: number): number {
  if (!clientBeds) return 100
  const d = Math.abs(propBeds - clientBeds)
  return d === 0 ? 100 : d === 1 ? 80 : d === 2 ? 40 : 0
}

export function scoreAmenities(features: string[], wishlist: string[]): number {
  if (!wishlist.length) return 100
  const matched = wishlist.filter(w => features.some(a => norm(a).includes(norm(w)) || norm(w).includes(norm(a))))
  return Math.round((matched.length / wishlist.length) * 100)
}

export interface ScoreResult {
  total: number
  budgetScore: number
  locationScore: number
  typeScore: number
  bedroomScore: number
  amenityScore: number
  eligible: boolean   // false = hard-excluded (type mismatch or budget out of range)
}

// A record only needs its requirements + budget + type to be scored — this lets
// the New Client form score against a not-yet-saved client.
export type ClientLike = Pick<Client, 'req' | 'budget' | 'type'>

// Default cutoff: matches scoring below this are hidden.
export const MATCH_THRESHOLD = 50

// Weights: budget 40%, location 25%, type 15%, bedrooms 12%, amenities 8%.
export function computeScore(
  prop: Property,
  client: ClientLike,
  ix: AreaIndex | null = loadedAreas(),
): ScoreResult {
  // Sale listings compare against the price; rentals against the monthly rent,
  // so the client's single budget is read in the same terms as the listing.
  const price    = prop.transaction === 'For Rent' ? prop.rent : prop.price
  const features = propFeatures(prop)
  const wish: string[] = [
    ...(client.req.garden  ? ['garden']  : []),
    ...(client.req.balcony ? ['balcony'] : []),
    // The client form's other must-haves, in propFeatures' terms.
    ...(client.req.terrace ? ['terrace'] : []),
    ...((client.req.parkings ?? 0) > 0 ? ['parking'] : []),
    ...(client.req.amenities ?? []).map(a => `unit:${norm(a)}`),
    ...(client.req.buildingFeatures ?? []).map(b => `building:${norm(b)}`),
  ]
  const rawBudget = scoreBudget(price, client.budget)
  const typeOk = !client.req.type || prop.type === client.req.type
  // Desired transaction: the explicit requirement, else derived from Buyer/Renter.
  const wantTxn = client.req.transaction
    || (client.type === 'Renter' ? 'For Rent' : client.type === 'Buyer' ? 'For Sale' : '')
  const txnOk = !wantTxn || prop.transaction === wantTxn
  // A client can be open to several areas — score against the best-matching one.
  // Comma-joined, not space-joined: "Achrafieh, Beirut" can be taken apart
  // again by the gazetteer, while "Achrafieh Beirut" is the name of nowhere.
  const rawLoc = scoreLocationMulti([prop.district, prop.city].filter(Boolean).join(', '), client.req, ix)
  const b  = rawBudget === BUDGET_EXCLUDE ? 0 : rawBudget
  const l  = rawLoc === LOCATION_EXCLUDE ? 0 : rawLoc
  const t  = typeOk ? 100 : 0
  const br = scoreBedrooms(prop.beds, client.req.beds)
  const a  = scoreAmenities(features, wish)
  // Hard filters (any one makes the match ineligible regardless of the rest):
  // mismatched specified type, buy/rent transaction mismatch, price >±50% off
  // budget, or a location outside the surrounding area.
  const eligible = typeOk && txnOk && rawBudget !== BUDGET_EXCLUDE && rawLoc !== LOCATION_EXCLUDE
  const total = (b * 0.40) + (l * 0.25) + (t * 0.15) + (br * 0.12) + (a * 0.08)
  return {
    total: Math.round(total * 100) / 100,
    budgetScore: b, locationScore: l, typeScore: t, bedroomScore: br, amenityScore: a,
    eligible,
  }
}

// ── Match finders ─────────────────────────────────────────────────────────────
// Both return results sorted best-first, above the threshold. Sold listings are
// excluded when matching properties to a client.

export interface PropertyMatch { property: Property; score: ScoreResult }
export interface ClientMatch   { client: Client;    score: ScoreResult }

export function matchProperties(
  client: ClientLike,
  properties: Property[],
  threshold = MATCH_THRESHOLD,
  ix: AreaIndex | null = loadedAreas(),
): PropertyMatch[] {
  return properties
    .filter(p => p.status !== 'Sold')
    .map(p => ({ property: p, score: computeScore(p, client, ix) }))
    .filter(r => r.score.eligible && r.score.total >= threshold)
    .sort((a, b) => b.score.total - a.score.total)
}

// ── Why a listing did not match ──────────────────────────────────────────────
// "No matches found" is a dead end: the agent is looking at a plot in Batroun
// that is obviously right for the client and has no way to learn that the
// asking price is outside ±50% of their budget. These turn every exclusion into
// a sentence, so the agent can fix the record or tell the client.

/**
 * One thing standing in the way. `weight` is how immovable it is: an agent can
 * talk about price, or correct a listing with no area on it, but cannot move a
 * plot to another caza or turn a villa into land.
 */
export interface MatchIssue {
  kind: 'sold' | 'type' | 'transaction' | 'budget' | 'location' | 'score'
  text: string
  weight: number
}

export interface NearMiss {
  property: Property
  score: ScoreResult
  /** Everything standing in the way, most immovable first. */
  reasons: MatchIssue[]
}

export interface NearMissClient {
  client: Client
  score: ScoreResult
  reasons: MatchIssue[]
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** How far a listing is from being usable: the sum of what stands in the way. */
const cost = (issues: MatchIssue[]) => issues.reduce((n, i) => n + i.weight, 0)

/** "an appartement", "a villa" — these lines are read by people. */
const a = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`

/** Every reason this listing is not a match. Empty means it is one. */
export function explainMatch(
  prop: Property,
  client: ClientLike,
  ix: AreaIndex | null = loadedAreas(),
  threshold = MATCH_THRESHOLD,
): MatchIssue[] {
  const reasons: MatchIssue[] = []
  const score = computeScore(prop, client, ix)

  if (prop.status === 'Sold') reasons.push({ kind: 'sold', weight: 5, text: 'Already sold' })

  if (client.req.type && prop.type !== client.req.type) {
    reasons.push({ kind: 'type', weight: 4, text: `It's ${a(prop.type.toLowerCase())} — they want ${client.req.type.toLowerCase()}` })
  }

  const wantTxn = client.req.transaction
    || (client.type === 'Renter' ? 'For Rent' : client.type === 'Buyer' ? 'For Sale' : '')
  if (wantTxn && prop.transaction !== wantTxn) {
    reasons.push({ kind: 'transaction', weight: 4, text: `Listed ${prop.transaction.toLowerCase()}, and they want ${wantTxn.toLowerCase()}` })
  }

  if (score.locationScore === 0) {
    const where = [prop.district, prop.city].filter(Boolean).join(', ')
    const wants = (client.req.locations?.length ? client.req.locations : [client.req.location]).filter(Boolean).join(' or ')
    reasons.push(where
      // A plot cannot move; a missing area is a record to correct.
      ? { kind: 'location', weight: 3, text: `In ${where} — too far from ${wants}` }
      : { kind: 'location', weight: 2, text: `The listing has no area on it, so it can't be placed near ${wants}` })
  }

  const price = prop.transaction === 'For Rent' ? prop.rent : prop.price
  if (client.budget && scoreBudget(price, client.budget) === BUDGET_EXCLUDE) {
    const low = money(client.budget * 0.5), high = money(client.budget * 1.5)
    reasons.push(price
      ? { kind: 'budget', weight: 1, text: `Asking ${money(price)} — their ${money(client.budget)} budget only reaches ${low}–${high}` }
      : { kind: 'budget', weight: 2, text: `No price on the listing, so it can't be compared to their ${money(client.budget)} budget` })
  }

  if (!reasons.length && score.total < threshold) {
    reasons.push({ kind: 'score', weight: 1, text: `Scores ${Math.round(score.total)}, under the ${threshold} cut-off` })
  }
  return reasons.sort((a, b) => b.weight - a.weight)
}

/**
 * The listings that came closest without matching.
 *
 * Ranked by how fixable the obstacles are, not by score: "the right plot in the
 * right area, but above their budget" is something an agent can act on today,
 * while a correctly-priced plot at the other end of the country is not, even
 * though it scores higher.
 */
export function nearMisses(
  client: ClientLike,
  properties: Property[],
  ix: AreaIndex | null = loadedAreas(),
  limit = 3,
  threshold = MATCH_THRESHOLD,
): NearMiss[] {
  return properties
    .map(property => ({ property, score: computeScore(property, client, ix), reasons: explainMatch(property, client, ix, threshold) }))
    .filter(r => r.reasons.length > 0)
    .sort((a, b) => cost(a.reasons) - cost(b.reasons) || b.score.total - a.score.total)
    .slice(0, limit)
}

/** The same, the other way round: which clients nearly wanted this listing. */
export function nearMissClients(
  property: Property,
  clients: Client[],
  ix: AreaIndex | null = loadedAreas(),
  limit = 3,
  threshold = MATCH_THRESHOLD,
): NearMissClient[] {
  return clients
    .map(client => ({ client, score: computeScore(property, client, ix), reasons: explainMatch(property, client, ix, threshold) }))
    .filter(r => r.reasons.length > 0)
    .sort((a, b) => cost(a.reasons) - cost(b.reasons) || b.score.total - a.score.total)
    .slice(0, limit)
}

export function matchClients(
  property: Property,
  clients: Client[],
  threshold = MATCH_THRESHOLD,
  ix: AreaIndex | null = loadedAreas(),
): ClientMatch[] {
  return clients
    .map(c => ({ client: c, score: computeScore(property, c, ix) }))
    .filter(r => r.score.eligible && r.score.total >= threshold)
    .sort((a, b) => b.score.total - a.score.total)
}
