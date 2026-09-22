// Warnings shown while a listing is being filled in.
//
// The listing form starts every new record as an Appartement, because most are.
// An agent adding a plot who fills in the title, the area, the size and the
// price — and never touches the type dropdown — creates a listing called "Land
// plot" whose type is Appartement. It then never reaches a single client
// looking for land, and nothing anywhere says why: the matcher excludes it on
// type before scoring, so it simply is not there.
//
// These are warnings, never blocks. An agent who means it can save anyway.
//
// Pure: no imports, so `node --test` loads it directly.

export interface ListingWarning {
  field: 'type'
  text: string
}

/** Types where having no bedroom and no bathroom means something is wrong. */
const LIVING_SPACE = ['Appartement', 'Duplex', 'Studio', 'Villa', 'Chalet', 'Standalone']

/** Words in a title that say "this is a plot", in the spellings agents use. */
const LAND_WORDS = /\b(land|plot|lot|terrain|parcel|ard|aradi|field)\b/i

export function listingWarnings(listing: {
  title?: string
  type?: string
  beds?: number | string
  baths?: number | string
}): ListingWarning[] {
  const out: ListingWarning[] = []
  const type = String(listing.type ?? '')
  const title = String(listing.title ?? '')
  const beds = Number(listing.beds) || 0
  const baths = Number(listing.baths) || 0

  if (LAND_WORDS.test(title) && type && type !== 'Land') {
    out.push({
      field: 'type',
      text: `The title says land, but the type is ${type}. Clients searching for Land will not see this listing.`,
    })
  } else if (LIVING_SPACE.includes(type) && beds === 0 && baths === 0) {
    out.push({
      field: 'type',
      text: `No bedrooms and no bathrooms for ${type === 'Appartement' ? 'an' : 'a'} ${type.toLowerCase()}. If this is land, a shop or a warehouse, change the type — it is what matching filters on first.`,
    })
  }

  return out
}
