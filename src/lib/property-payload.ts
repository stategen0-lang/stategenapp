// What the listing form sends when it saves.
//
// Split out of the form for one reason: a field can be added to the form, shown
// on screen, read by the AI description — and quietly left out of the payload,
// so it is never stored and is gone the next time the listing is opened. That
// happened to Public Notes, and the description kept working the whole time
// because the AI call posts the form object wholesale while the save posts this.
//
// The test beside this file walks the form's own keys and fails if any of them
// is missing here, so the next field cannot be forgotten the same way.

export interface ListingForm {
  title: string
  type: string
  transaction: string
  price: string
  rent: string
  /** One field on screen; stored as district + city. */
  area: string
  size: string
  beds: string
  baths: string
  parkings: string
  buildingAge: string
  floor: string
  needsRenovation: boolean
  garden: boolean
  balcony: boolean
  terrace: boolean
  furnishing: string
  view: string
  mapUrl: string
  video: string
  status: string
  advancedPayment: string
  aiDescription: string
  aiDescriptionAr: string
  notes: string
  publicNotes: string
  referredBy: string
  ownerName: string
  ownerContact: string
}

export interface ListingExtras {
  agentId: string
  amenities: string[]
  buildingFeatures: string[]
  photos: string[]
  documentPath: string
  documentName: string
}

const num = (v: string) => parseInt(v, 10) || 0
const opt = (v: string) => parseInt(v, 10) || undefined
const text = (v: string) => v.trim() || undefined

export function propertyPayload(form: ListingForm, extra: ListingExtras): Record<string, unknown> {
  return {
    title: form.title,
    type: form.type,
    transaction: form.transaction,
    price: num(form.price),
    rent: num(form.rent),
    // The single "area" field is stored as the location; the separate
    // neighbourhood field is retired, so it always saves empty.
    district: '',
    city: form.area.trim(),
    size: num(form.size),
    beds: num(form.beds),
    baths: num(form.baths),
    parkings: opt(form.parkings),
    buildingAge: opt(form.buildingAge),
    needsRenovation: form.needsRenovation || undefined,
    floor: form.floor || undefined,
    garden: form.garden,
    balcony: form.balcony,
    terrace: form.terrace,
    amenities: extra.amenities,
    buildingFeatures: extra.buildingFeatures,
    furnishing: form.furnishing || undefined,
    view: form.view,
    mapUrl: text(form.mapUrl),
    video: text(form.video),
    status: form.status,
    agentId: extra.agentId,
    aiDescription: form.aiDescription || undefined,
    aiDescriptionAr: form.aiDescriptionAr || undefined,
    notes: form.notes || undefined,
    publicNotes: form.publicNotes || undefined,
    referredBy: text(form.referredBy),
    ownerName: text(form.ownerName),
    ownerContact: text(form.ownerContact),
    documentPath: extra.documentPath || undefined,
    documentName: extra.documentName || undefined,
    // Only a rental takes an advance.
    advancedPayment: (form.transaction === 'For Rent' && form.advancedPayment) ? form.advancedPayment : undefined,
    photos: extra.photos.length > 0 ? extra.photos : undefined,
  }
}
