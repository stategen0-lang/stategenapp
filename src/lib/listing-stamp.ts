// The stamp: the one thing worth shouting about a listing, picked from its own
// data so nobody has to write it.
//
// It exists for the marketing email — the team posts to OLX, Instagram and
// Facebook, where a listing gets about a second of attention and the headline
// does the work. So this returns ONE line, not a list of features: a stamp
// saying four things says nothing.
//
// The order below is the whole design. For an ordinary property the agency's
// two strongest selling points in this market are that it is furnished and
// that the payment can be spread, so those outrank even a sea view. A plot is
// judged on completely different things, so Land has its own order.
//
// Pure: no imports, so `node --test` loads it directly.

export interface Stamp {
  /** Short, upper-case, for the badge. */
  text: string
  /** The same thing in Arabic — the post is usually written in both. */
  ar: string
}

export interface StampInput {
  type?: string
  view?: string
  furnishing?: string
  amenities?: string[]
  buildingFeatures?: string[]
  buildingAge?: number
  garden?: boolean
  terrace?: boolean
  parkings?: number
  size?: number
}

const has = (list: string[] | undefined, name: string) =>
  (list ?? []).some(a => String(a).trim().toLowerCase() === name.toLowerCase())

const viewIs = (view: string | undefined, word: string) =>
  new RegExp(`\\b${word}`, 'i').test(String(view ?? ''))

/** Every stamp we can award, each with the test that earns it. */
const CANDIDATES: { id: string; text: string; ar: string; when: (l: StampInput) => boolean }[] = [
  { id: 'flat',     text: 'Flat Land · 0% Slope', ar: 'أرض مستوية',        when: l => has(l.amenities, 'Flat Land (0% slope)') },
  { id: 'permit',   text: 'Building Permit',      ar: 'رخصة بناء',          when: l => has(l.amenities, 'Building Permit') },
  { id: 'furnished',text: 'Furnished',            ar: 'مفروش',              when: l => String(l.furnishing ?? '').toLowerCase() === 'furnished' },
  { id: 'payment',  text: 'Payment Facilities',   ar: 'تسهيلات بالدفع',     when: l => has(l.amenities, 'Credit Facilities') },
  { id: 'sea',      text: 'Sea View',             ar: 'إطلالة على البحر',   when: l => viewIs(l.view, 'sea') || viewIs(l.view, 'ocean') },
  { id: 'prime',    text: 'Prime Location',       ar: 'موقع مميز',          when: l => has(l.amenities, 'Prime Location') },
  { id: 'panoramic',text: 'Panoramic View',       ar: 'إطلالة بانورامية',   when: l => viewIs(l.view, 'panoram') },
  { id: 'mountain', text: 'Mountain View',        ar: 'إطلالة جبلية',       when: l => viewIs(l.view, 'mountain') },
  { id: 'new',      text: 'Brand New',            ar: 'جديد',               when: l => l.buildingAge === 0 },
  { id: 'pool',     text: 'With Pool',            ar: 'مع مسبح',            when: l => has(l.amenities, 'Pool') },
  { id: 'garden',   text: 'Private Garden',       ar: 'حديقة خاصة',         when: l => !!l.garden },
  { id: 'terrace',  text: 'Large Terrace',        ar: 'تراس واسع',          when: l => !!l.terrace },
]

// A plot has no furniture and no view from a balcony; what sells it is that it
// is flat, permitted, and where it is.
const LAND_ORDER = ['flat', 'permit', 'sea', 'prime', 'payment', 'panoramic', 'mountain']
const ORDER = ['furnished', 'payment', 'sea', 'prime', 'panoramic', 'mountain', 'new', 'pool', 'garden', 'terrace']

/**
 * Every listing gets one. When a property has nothing remarkable on file, it is
 * still genuinely news to the marketing team — that is what the email is — and
 * a true stamp beats a flattering invented one.
 */
export const DEFAULT_STAMP: Stamp = { text: 'New Listing', ar: 'عرض جديد' }

export function propertyStamp(listing: StampInput): Stamp {
  const order = String(listing.type ?? '').toLowerCase() === 'land' ? LAND_ORDER : ORDER
  for (const id of order) {
    const c = CANDIDATES.find(x => x.id === id)
    if (c && c.when(listing)) return { text: c.text, ar: c.ar }
  }
  return DEFAULT_STAMP
}
