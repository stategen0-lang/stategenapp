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

// ── Sharing templates across the agency ─────────────────────────────────────
//
// Templates used to live only in the browser that created them, so a manager's
// house style never reached their agents — the whole point of the feature. They
// are now stored on the company and fetched by every device; localStorage stays
// as an offline cache for instant paint.

/** Hard caps, so one paste can't fill the column or the editor. */
export const MAX_TEMPLATES = 30
export const MAX_TEMPLATE_BODY = 8000
const MAX_NAME = 80

/**
 * Clean a list of templates coming from anywhere (the browser, the database, an
 * older format). Keeps only usable entries, gives every one a unique id, and
 * leaves at most one active — the active template is what the AI uses, so two
 * would make the result depend on array order.
 */
export function sanitizeTemplates(input: unknown): DescriptionTemplate[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: DescriptionTemplate[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Partial<DescriptionTemplate>
    const body = typeof t.body === 'string' ? t.body.slice(0, MAX_TEMPLATE_BODY) : ''
    const name = typeof t.name === 'string' ? t.name.trim().slice(0, MAX_NAME) : ''
    if (!body.trim() && !name) continue

    let id = typeof t.id === 'string' && t.id.trim() ? t.id.trim().slice(0, 40) : `t${out.length}`
    while (seen.has(id)) id = `${id}_`
    seen.add(id)

    out.push({ id, name: name || 'Untitled', body, active: t.active === true })
    if (out.length >= MAX_TEMPLATES) break
  }

  const firstActive = out.findIndex(t => t.active)
  return out.map((t, i) => ({ ...t, active: i === firstActive }))
}

/** The body the AI should use, i.e. the active template's. */
export function activeBody(templates: DescriptionTemplate[]): string | null {
  return templates.find(t => t.active)?.body?.trim() || null
}

/** Remember the agency's templates for the next page load (cache only). */
export function cacheTemplates(templates: DescriptionTemplate[]): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)) } catch { /* ignore */ }
}

/**
 * The agency's templates from the server, for every agent — not just whoever
 * created them. Falls back to the cached copy, then to the built-in defaults, so
 * the New Listing form always has something to offer.
 */
export async function fetchTemplates(): Promise<DescriptionTemplate[]> {
  try {
    const res = await fetch('/api/company/template')
    if (res.ok) {
      const data = await res.json()
      const shared = sanitizeTemplates(data?.templates)
      if (shared.length) { cacheTemplates(shared); return shared }
      // The agency hasn't saved any yet: the defaults, not a stale local copy.
      if (Array.isArray(data?.templates)) return DEFAULT_TEMPLATES
    }
  } catch { /* offline — fall through to the cache */ }
  return loadTemplates()
}
