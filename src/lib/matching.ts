// ── Property ⇄ Client matching algorithm ─────────────────────────────────────
// Pure, deterministic scoring shared by the UI (MatchCards) and unit tests.
// No React / DOM / network here so it can be tested in isolation.

import type { Property, Client } from '@/lib/data'

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

// Location: same area (exact match or same zone) → 100, surrounding area
// (a neighbouring zone) → 75, anywhere further → LOCATION_EXCLUDE.
export function scoreLocation(propLoc: string, clientLoc: string): number {
  if (!clientLoc) return 100                       // no preference → no constraint
  const p = norm(propLoc); const c = norm(clientLoc)
  if (p.includes(c) || c.includes(p)) return 100   // same specific area

  const pZone = Object.entries(ZONES).find(([zone, areas]) => p.includes(zone) || areas.some(a => p.includes(a)))?.[0]
  const cZone = Object.entries(ZONES).find(([zone, areas]) => c.includes(zone) || areas.some(a => c.includes(a)))?.[0]

  if (pZone && cZone && pZone === cZone) return 100 // same zone = same area
  if (pZone && cZone && NEIGHBOURS.some(([a, b]) => (a === pZone && b === cZone) || (b === pZone && a === cZone))) return 75 // surrounding
  return LOCATION_EXCLUDE
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
export function computeScore(prop: Property, client: ClientLike): ScoreResult {
  // Sale listings compare against the price; rentals against the monthly rent,
  // so the client's single budget is read in the same terms as the listing.
  const price    = prop.transaction === 'For Rent' ? prop.rent : prop.price
  const features = propFeatures(prop)
  const wish: string[] = [
    ...(client.req.garden  ? ['garden']  : []),
    ...(client.req.balcony ? ['balcony'] : []),
  ]
  const rawBudget = scoreBudget(price, client.budget)
  const typeOk = !client.req.type || prop.type === client.req.type
  // Desired transaction: the explicit requirement, else derived from Buyer/Renter.
  const wantTxn = client.req.transaction
    || (client.type === 'Renter' ? 'For Rent' : client.type === 'Buyer' ? 'For Sale' : '')
  const txnOk = !wantTxn || prop.transaction === wantTxn
  const rawLoc = scoreLocation(`${prop.district} ${prop.city}`, client.req.location)
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
): PropertyMatch[] {
  return properties
    .filter(p => p.status !== 'Sold')
    .map(p => ({ property: p, score: computeScore(p, client) }))
    .filter(r => r.score.eligible && r.score.total >= threshold)
    .sort((a, b) => b.score.total - a.score.total)
}

export function matchClients(
  property: Property,
  clients: Client[],
  threshold = MATCH_THRESHOLD,
): ClientMatch[] {
  return clients
    .map(c => ({ client: c, score: computeScore(property, c) }))
    .filter(r => r.score.eligible && r.score.total >= threshold)
    .sort((a, b) => b.score.total - a.score.total)
}
