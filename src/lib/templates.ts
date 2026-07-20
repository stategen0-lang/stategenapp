// Description templates, shared by Profile settings (where they're managed)
// and the New Listing modal (where they're used).
//
// A template is either a short style note — the AI writes free-form copy in
// that tone — or a full structured layout with [placeholders], which the AI
// reproduces exactly, filling the placeholders from the listing's data.

export interface DescriptionTemplate {
  id: string
  name: string
  body: string
  active: boolean
}

export const STORAGE_KEY = 'descriptionTemplates'

export const FULL_LISTING_TEMPLATE = `[Own / Rent] This [Adjective] [Property Type] for [Rent / Sale] in [Location]!
A beautifully designed [SIZE] sqm [property type] featuring a spacious layout, elegant interiors, and a comfortable atmosphere is now available for [rent / sale] in [Location]. Located in one of the area's prestigious buildings, this property also enjoys [view feature].
Situated in a prime location, the [property type] offers easy access to all essential amenities and is just minutes away from major facilities.
[Property Type] Features:
Spacious living room
Dining room
Kitchen
[X] Master bedroom(s)
[X] Regular bedroom(s)
[X] Bathroom(s)
Balconies
Additional Features:
Calm and quiet neighborhood
Minutes away from major facilities
Full heating system
Central air conditioning system
AC installation
[X] Parking space(s)
Rental Price: $ [AMOUNT] /month`

export const DEFAULT_TEMPLATES: DescriptionTemplate[] = [
  { id: 't0', name: 'Full listing (structured)', body: FULL_LISTING_TEMPLATE, active: false },
  { id: 't1', name: 'Luxury', body: 'Emphasize exclusivity, premium finishes, and lifestyle. Use elegant language. Mention prestige of location.', active: false },
  { id: 't2', name: 'Commercial', body: 'Focus on business potential, visibility, foot traffic, and ROI. Keep tone professional and concise.', active: false },
  { id: 't3', name: 'Standard', body: 'Balanced, friendly tone. Highlight value for money, practical features, and neighborhood character.', active: false },
]

// Saved templates, falling back to the defaults. The New Listing modal used to
// start from an empty list and only read localStorage, so the templates shown
// in settings were unavailable when writing a listing until you edited one.
export function loadTemplates(): DescriptionTemplate[] {
  if (typeof window === 'undefined') return DEFAULT_TEMPLATES
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return DEFAULT_TEMPLATES
    const parsed = JSON.parse(saved) as DescriptionTemplate[]
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_TEMPLATES
  } catch {
    return DEFAULT_TEMPLATES
  }
}
