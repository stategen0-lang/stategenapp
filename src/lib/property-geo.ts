// Putting a listing on a map.
//
// Two sources, in order of trust:
//   1. the exact location an agent pinned — parsed out of the Google Maps link
//      already stored on the listing, so nothing new has to be filled in;
//   2. the centre of its area, from the gazetteer, which every listing has
//      because the area field is required.
//
// The second is an approximation and is marked as one: a map that shows forty
// listings pinned to the exact same point in Achrafieh is not lying, but an
// agent needs to know those pins mean "in Achrafieh" and not "here".
//
// Pure, with relative imports, so `node --test` loads it directly.

import type { Property } from '@/lib/data'
import { resolveArea, type AreaIndex } from './lebanon/areas.ts'

export interface LatLng { lat: number; lng: number }

export interface PropertyPoint extends LatLng {
  property: Property
  /** True when the agent pinned it; false when it is the area's centre. */
  exact: boolean
}

/** Lebanon's bounding box, give or take. Anything outside it is a misparse. */
const BOUNDS = { minLat: 33.0, maxLat: 34.75, minLng: 35.0, maxLng: 36.7 }

export function inLebanon(p: LatLng): boolean {
  return p.lat >= BOUNDS.minLat && p.lat <= BOUNDS.maxLat
    && p.lng >= BOUNDS.minLng && p.lng <= BOUNDS.maxLng
}

/**
 * The coordinates inside a Google Maps link, in any of the shapes agents
 * actually paste:
 *
 *   .../@33.8869,35.5131,17z           the view centre — what "share" gives
 *   .../data=...!3d33.8869!4d35.5131   the pin itself, which beats the centre
 *   ...?q=33.8869,35.5131              a plain coordinate search
 *   ...?ll=33.8869,35.5131
 *
 * A shortened link (maps.app.goo.gl) carries no coordinates at all and would
 * have to be followed over the network, which this does not do — it returns
 * null and the listing falls back to its area.
 */
export function parseLatLng(url: string | null | undefined): LatLng | null {
  const s = String(url ?? '')
  if (!s) return null

  const num = String.raw`(-?\d+\.\d+)`
  const patterns = [
    // The pin, when the link carries one: !3d<lat>!4d<lng>.
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`[?&](?:q|ll|daddr|center)=${num},\\s*${num}`, 'i'),
    new RegExp(`@${num},${num}`),
  ]

  for (const re of patterns) {
    const m = re.exec(s)
    if (!m) continue
    const point = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
    if (Number.isFinite(point.lat) && Number.isFinite(point.lng) && inLebanon(point)) return point
  }
  return null
}

/**
 * Where a listing goes. Returns null only when the pin is unusable AND the area
 * is not one the gazetteer knows — those listings are counted and reported
 * rather than dropped in silence.
 */
export function propertyPoint(
  property: Property,
  ix: AreaIndex | null,
  mapUrl: string | null | undefined = property.mapUrl,
): PropertyPoint | null {
  const pinned = parseLatLng(mapUrl)
  if (pinned) return { ...pinned, property, exact: true }

  if (!ix) return null
  // The area as filed. City first — that is where the single area field is
  // stored — then the older district column for listings that predate it.
  for (const text of [property.city, property.district]) {
    const found = resolveArea(ix, text)
    if (found?.confident) return { lat: found.area.lat, lng: found.area.lng, property, exact: false }
  }
  return null
}

/** Round to ~11 m, the grid two listings must share to count as one pin. */
const key = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`

export interface PointCluster extends LatLng {
  properties: Property[]
  /** True only when every listing at this pin was placed exactly. */
  exact: boolean
}

/**
 * Listings that share a point become one marker. Without this an area's whole
 * inventory stacks into a single pin and the map claims to hold one listing
 * where it holds thirty.
 */
export function clusterPoints(points: PropertyPoint[]): PointCluster[] {
  const byKey = new Map<string, PointCluster>()
  for (const p of points) {
    const k = key(p)
    const existing = byKey.get(k)
    if (existing) {
      existing.properties.push(p.property)
      existing.exact = existing.exact && p.exact
    } else {
      byKey.set(k, { lat: p.lat, lng: p.lng, properties: [p.property], exact: p.exact })
    }
  }
  // Biggest last so the heaviest pins draw on top of the ones they overlap.
  return [...byKey.values()].sort((a, b) => a.properties.length - b.properties.length)
}

export interface Bounds { south: number; west: number; north: number; east: number }

/** The box that holds every point, or null when there are none to hold. */
export function boundsOf(points: LatLng[]): Bounds | null {
  if (!points.length) return null
  let south = points[0].lat, north = points[0].lat
  let west = points[0].lng, east = points[0].lng
  for (const p of points) {
    if (p.lat < south) south = p.lat
    if (p.lat > north) north = p.lat
    if (p.lng < west) west = p.lng
    if (p.lng > east) east = p.lng
  }
  return { south, west, north, east }
}

/** A listing's colour on the map: what an agent scans for first. */
export function statusColor(status: string | undefined): string {
  switch (String(status ?? '').toLowerCase()) {
    case 'sold':     return '#A23434'
    case 'reserved': return '#9A6516'
    case 'rented':   return '#6A7488'
    default:         return '#1F7A4D'   // Available
  }
}
