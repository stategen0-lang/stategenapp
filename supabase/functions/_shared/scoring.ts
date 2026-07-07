// Shared scoring logic — spec-compliant weighted formula
// Used by both Edge Functions and the client-side MatchCards fallback

export interface ScoreBreakdown {
  budgetScore:   number  // 0–100
  locationScore: number
  typeScore:     number
  bedroomScore:  number
  amenityScore:  number
  total:         number  // weighted final score
}

// Areas considered adjacent in Lebanese real estate market
const ADJACENCY: Record<string, string[]> = {
  beirut:      ['hamra', 'raouche', 'raouché', 'ashrafieh', 'gemmayzeh', 'verdun', 'mar mikhael', 'monot', 'badaro', 'mazraa', 'achrafieh', 'koraytem'],
  metn:        ['naccache', 'dbayeh', 'antelias', 'zalka', 'jal el dib', 'beit mery', 'broumana', 'mtayleb', 'baabda'],
  keserwan:    ['jounieh', 'kaslik', 'ghazir', 'zouk'],
}

function normalise(s: string) { return s.toLowerCase().trim() }

function locationScore(propLocation: string, clientLocation: string): number {
  if (!clientLocation) return 100
  const p = normalise(propLocation)
  const c = normalise(clientLocation)
  if (p.includes(c) || c.includes(p)) return 100
  // Find which zone each belongs to
  for (const zone of Object.values(ADJACENCY)) {
    const pInZone = zone.some(a => p.includes(a))
    const cInZone = zone.some(a => c.includes(a))
    if (pInZone && cInZone) return 60
  }
  return 0
}

function budgetScore(propPrice: number, clientBudget: number): number {
  if (!clientBudget || clientBudget <= 0) return 100
  if (clientBudget >= propPrice) return 100
  const gap = (propPrice - clientBudget) / propPrice
  if (gap > 0.15) return 0
  // Linear from 100 (gap=0) to 0 (gap=0.15)
  return Math.round((1 - gap / 0.15) * 100)
}

function bedroomScore(propBeds: number, clientBeds: number): number {
  if (!clientBeds) return 100
  const diff = Math.abs(propBeds - clientBeds)
  if (diff === 0) return 100
  if (diff === 1) return 80
  if (diff === 2) return 40
  return 0
}

function amenityScore(propAmenities: string[], clientWishlist: string[]): number {
  if (!clientWishlist || clientWishlist.length === 0) return 100
  const matched = clientWishlist.filter(w =>
    propAmenities.some(a => normalise(a).includes(normalise(w)) || normalise(w).includes(normalise(a)))
  )
  return Math.round((matched.length / clientWishlist.length) * 100)
}

export function computeScore(
  prop: { price: number; location: string; type: string; bedrooms: number; amenities: string[] },
  client: { budget_max: number; preferred_location: string; preferred_type: string; bedrooms: number; amenity_wishlist: string[] }
): ScoreBreakdown {
  const b  = budgetScore(prop.price, client.budget_max)
  const l  = locationScore(prop.location, client.preferred_location)
  const t  = prop.type === client.preferred_type ? 100 : 0
  const br = bedroomScore(prop.bedrooms, client.bedrooms)
  const a  = amenityScore(prop.amenities, client.amenity_wishlist)

  const total = (b * 0.40) + (l * 0.25) + (t * 0.15) + (br * 0.12) + (a * 0.08)

  return {
    budgetScore:   b,
    locationScore: l,
    typeScore:     t,
    bedroomScore:  br,
    amenityScore:  a,
    total:         Math.round(total * 100) / 100,
  }
}
