// Which fields belong to which kind of listing.
//
// A plot of land has no bedrooms, no balcony and no furnishing, yet the form
// asked for all of them and the detail sheet reported "Bedrooms N/A, Garden No,
// Balcony No" underneath a photograph of a field. Worse, an agent who filled
// them in before switching the type left a plot carrying 3 beds and 2 baths.
//
// One table, read by the listing form (which fields to show, and which values
// to clear when the type changes), the detail sheet (which facts to print) and
// anything else that has to know. Add a field here and both follow.
//
// Pure: no imports, so `node --test` loads it directly.

export type ListingField =
  | 'beds' | 'baths' | 'parkings' | 'size'
  | 'buildingAge' | 'floor' | 'needsRenovation'
  | 'garden' | 'balcony' | 'terrace'
  | 'furnishing' | 'view' | 'buildingFeatures'

const ALL: ListingField[] = [
  'beds', 'baths', 'parkings', 'size', 'buildingAge', 'floor', 'needsRenovation',
  'garden', 'balcony', 'terrace', 'furnishing', 'view', 'buildingFeatures',
]

// Everything someone lives in: the full set.
const HOME: ListingField[] = ALL

// A plot. Size, where it is, what you can see from it — nothing else applies.
// Its own tick-boxes (slope, road access, permit) come from LAND_AMENITIES.
const LAND: ListingField[] = ['size', 'view']

// A whole building: it has no single floor and nobody furnishes it, but its
// age, parking, lift and condition all matter.
const BUILDING: ListingField[] = [
  'size', 'parkings', 'buildingAge', 'needsRenovation', 'view', 'buildingFeatures', 'garden',
]

// Somewhere a business operates: a toilet, parking, which floor it is on and
// the state of it all matter; bedrooms and gardens do not. Offices and shops
// are genuinely let furnished or unfurnished, so furnishing stays.
const COMMERCIAL: ListingField[] = [
  'size', 'baths', 'parkings', 'buildingAge', 'floor', 'needsRenovation',
  'furnishing', 'view', 'buildingFeatures', 'terrace',
]

// Storage and parking: no bathroom worth listing, nothing to furnish.
const UTILITY: ListingField[] = [
  'size', 'parkings', 'buildingAge', 'floor', 'needsRenovation', 'buildingFeatures',
]

const BY_TYPE: Record<string, ListingField[]> = {
  Appartement: HOME, Duplex: HOME, Studio: HOME, Villa: HOME, Chalet: HOME, Standalone: HOME,
  Building: BUILDING,
  Land: LAND,
  Shop: COMMERCIAL, Office: COMMERCIAL, Showroom: COMMERCIAL, Restaurant: COMMERCIAL,
  Warehouse: [...UTILITY, 'baths'],
  Garage: UTILITY,
}

const LABELS: Record<string, string> = {
  beds: 'bedrooms', baths: 'bathrooms', parkings: 'parking', size: 'size',
  buildingAge: 'building age', floor: 'floor', needsRenovation: 'renovation',
  garden: 'garden', balcony: 'balcony', terrace: 'terrace',
  furnishing: 'furnishing', view: 'view', buildingFeatures: 'building features',
}

/** The field's name as an agent would say it. */
export function fieldLabel(field: string): string {
  return LABELS[field] ?? field
}

/** The fields worth asking for, and worth printing, for this type. */
export function fieldsFor(type: string | null | undefined): ListingField[] {
  return BY_TYPE[String(type ?? '')] ?? HOME
}

/** Does this field apply to this type? Unknown types keep everything. */
export function hasField(type: string | null | undefined, field: ListingField): boolean {
  return fieldsFor(type).includes(field)
}

/**
 * The values to wipe when a listing changes type.
 *
 * Switching an apartment to land has to take the bedrooms with it, or the plot
 * keeps them: invisible in a form that no longer shows the box, but still in
 * the database, still in the description the AI writes, still on the card.
 */
export function clearedByTypeChange(
  type: string | null | undefined,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const keep = new Set(fieldsFor(type))
  const cleared: Record<string, unknown> = {}
  const blanks: Record<ListingField, unknown> = {
    beds: '', baths: '', parkings: '', size: '', buildingAge: '', floor: '',
    needsRenovation: false, garden: false, balcony: false, terrace: false,
    furnishing: '', view: '', buildingFeatures: [],
  }
  for (const field of ALL) {
    if (keep.has(field)) continue
    const now = current[field]
    const blank = blanks[field]
    // Only report a change when there is something to clear, so the caller can
    // tell the agent exactly what it dropped.
    const empty = now === undefined || now === blank
      || (Array.isArray(now) && now.length === 0)
      || (typeof blank === 'string' && (now === 0 || now === '0'))
    if (!empty) cleared[field] = blank
  }
  return cleared
}
