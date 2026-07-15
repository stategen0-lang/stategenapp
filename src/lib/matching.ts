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

// Budget: full marks if within budget, then falls off linearly to 0 once the
// property is >15% over budget.
export function scoreBudget(propPrice: number, clientBudget: number): number {
  if (!clientBudget) return 100
  if (clientBudget >= propPrice) return 100
  const gap = (propPrice - clientBudget) / propPrice
  return gap > 0.15 ? 0 : Math.round((1 - gap / 0.15) * 100)
}

export function scoreLocation(propLoc: string, clientLoc: string): number {
  if (!clientLoc) return 100
  const p = norm(propLoc); const c = norm(clientLoc)
  if (p.includes(c) || c.includes(p)) return 100

  const pZone = Object.entries(ZONES).find(([, areas]) => areas.some(a => p.includes(a)))?.[0]
  const cZone = Object.entries(ZONES).find(([, areas]) => areas.some(a => c.includes(a)))?.[0]

  if (pZone && cZone && pZone === cZone) return 60
  if (pZone && cZone && NEIGHBOURS.some(([a, b]) => (a === pZone && b === cZone) || (b === pZone && a === cZone))) return 35
  if (pZone && cZone) return 15
  return 0
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
}

// Weights: budget 40%, location 25%, type 15%, bedrooms 12%, amenities 8%.
export function computeScore(prop: Property, client: Client): ScoreResult {
  const price    = prop.transaction === 'For Rent' ? prop.rent * 12 : prop.price
  const features = propFeatures(prop)
  const wish: string[] = [
    ...(client.req.garden  ? ['garden']  : []),
    ...(client.req.balcony ? ['balcony'] : []),
  ]
  const b  = scoreBudget(price, client.req.priceMax || client.budget)
  const l  = scoreLocation(`${prop.district} ${prop.city}`, client.req.location)
  const t  = !client.req.type || prop.type === client.req.type ? 100 : 0
  const br = scoreBedrooms(prop.beds, client.req.beds)
  const a  = scoreAmenities(features, wish)
  const total = (b * 0.40) + (l * 0.25) + (t * 0.15) + (br * 0.12) + (a * 0.08)
  return {
    total: Math.round(total * 100) / 100,
    budgetScore: b, locationScore: l, typeScore: t, bedroomScore: br, amenityScore: a,
  }
}
