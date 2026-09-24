// Places an agency teaches the app.
//
// The built-in gazetteer holds 3,602 places and Lebanon has more than that.
// When an agent types somewhere it does not know — "Hbous" — the old behaviour
// was to save the text and forget it, so the next agent typed it again, spelled
// it differently, and the two listings never matched the same client.
//
// Instead the agent drops a pin on it once. From then on that place is part of
// their agency's gazetteer: it is suggested as they type, corrected to a single
// spelling, and — because it has real coordinates — used by matching exactly
// like a built-in area. The more the agency works, the fewer places are missing.
//
// A pin is enough on its own: the caza and governorate are read off the nearest
// place we already know, which is how the built-in data assigns them too. So the
// agent answers one question ("where is it?"), not three.
//
// Learned areas are the agency's own. One process serves every agency, so they
// are never merged into the shared index — see extendIndex.
//
// Pure, relative imports: `node --test` loads it directly.

import type { Area, AreaIndex } from './areas-core.ts'
import { foldArea, distanceKm, resolveArea } from './areas-core.ts'

/** A place as the database stores it. */
export interface LearnedAreaRow {
  id?: number
  name: string
  lat: number
  lng: number
  caza?: string | null
  governorate?: string | null
}

/** Lebanon's bounding box. A pin outside it is a mistake, not a place. */
const BOUNDS = { minLat: 33.0, maxLat: 34.75, minLng: 35.0, maxLng: 36.7 }

export function pinInLebanon(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat
    && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng
}

/**
 * Names we refuse to learn. Not validation for its own sake: a bad row here is
 * permanent and silently steers every future match.
 */
export const MAX_NAME = 40

export type PinCheck =
  | { ok: true; name: string; lat: number; lng: number }
  | { ok: false; error: string }

export function checkPin(rawName: unknown, rawLat: unknown, rawLng: unknown): PinCheck {
  const name = String(rawName ?? '').replace(/\s+/g, ' ').trim()
  const lat = Number(rawLat)
  const lng = Number(rawLng)

  if (name.length < 2) return { ok: false, error: 'Give the area a name.' }
  if (name.length > MAX_NAME) return { ok: false, error: `That name is too long (${MAX_NAME} characters at most).` }
  // A name of pure punctuation or digits is not a place.
  if (!/[a-zA-ZÀ-ɏ؀-ۿ]/.test(name)) return { ok: false, error: 'That does not look like a place name.' }
  if (!pinInLebanon(lat, lng)) return { ok: false, error: 'Put the pin on the map inside Lebanon.' }

  return { ok: true, name, lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) }
}

/**
 * Is this place already in the gazetteer under a name we would correct to?
 *
 * Checked before saving, so an agency does not end up with its own "Achrafiye"
 * sitting beside the real Achrafieh — that would undo the one thing the
 * gazetteer is for.
 */
export function alreadyKnown(ix: AreaIndex, name: string): Area | null {
  const found = resolveArea(ix, name)
  return found?.confident ? found.area : null
}

/** The nearest place we already know, for reading a caza off. */
export function nearestArea(ix: AreaIndex, lat: number, lng: number): Area | null {
  let best: Area | null = null
  let bestKm = Infinity
  const at = { lat, lng }
  for (const area of ix.areas) {
    const km = distanceKm(at as Area, area)
    if (km < bestKm) { bestKm = km; best = area }
  }
  return best
}

/**
 * A pin, filled out into a gazetteer entry. The caza and governorate come from
 * the nearest known place — a pin in Aley is surrounded by Aley — which is what
 * makes a learned area work for clients who ask for a whole caza.
 */
export function areaFromPin(ix: AreaIndex, name: string, lat: number, lng: number): LearnedAreaRow {
  const near = nearestArea(ix, lat, lng)
  return {
    name,
    lat,
    lng,
    caza: near?.caza ?? '',
    governorate: near?.governorate ?? '',
  }
}

/**
 * Database rows as the index wants them.
 *
 * Learned areas are `hot`: an agency only teaches the app a place it actually
 * works in, so it outranks the hamlets around it in the suggestion list. Rows
 * with no usable name or a pin outside Lebanon are dropped rather than trusted —
 * this runs on data that has been sitting in a table for a year.
 */
export function learnedAreas(rows: LearnedAreaRow[]): Area[] {
  const out: Area[] = []
  const seen = new Set<string>()
  for (const row of rows ?? []) {
    const name = String(row?.name ?? '').trim()
    const f = foldArea(name)
    if (!f || seen.has(f)) continue
    if (!pinInLebanon(Number(row.lat), Number(row.lng))) continue
    seen.add(f)
    out.push({
      // Prefixed so a learned area can never collide with a built-in slug.
      slug: `learned-${f.replace(/ /g, '-')}`,
      name,
      governorate: String(row.governorate ?? ''),
      caza: String(row.caza ?? ''),
      lat: Number(row.lat),
      lng: Number(row.lng),
      hot: true,
      aliases: [],
    })
  }
  return out
}
