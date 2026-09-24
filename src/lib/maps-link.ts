// Reading a place out of a Google Maps link.
//
// Agents already carry Google Maps on their phone, know how to find anywhere in
// it, and can share a link in two taps. So rather than teach them a map inside
// StateGen, we take what they already produce: they paste the link, we take the
// coordinates out of it.
//
// Three shapes arrive, and only the first two carry coordinates:
//
//   1. a full desktop URL   .../@33.8869,35.5131,17z   or  !3d33.88!4d35.51
//   2. a pasted coordinate  "33.8869, 35.5131"  (long-press → copy in the app)
//   3. a shortened link     maps.app.goo.gl/x7Yk...    ← no coordinates at all
//
// The third is what the phone's Share button gives, which makes it the common
// case, and the only way to read it is to follow the redirect and look at where
// it lands. That is a server fetch of an address someone typed, so the host is
// checked against a closed list before and after every hop — see resolveMapsLink
// in the API route. This module is the pure half: no network, unit-tested.

export interface LatLng { lat: number; lng: number }

/** Lebanon's bounding box. A coordinate outside it is a misparse or a mistake. */
const BOUNDS = { minLat: 33.0, maxLat: 34.75, minLng: 35.0, maxLng: 36.7 }

export function inLebanon(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= BOUNDS.minLat && p.lat <= BOUNDS.maxLat
    && p.lng >= BOUNDS.minLng && p.lng <= BOUNDS.maxLng
}

/**
 * The only hosts we will ever fetch. A link is pasted by a person, and the
 * server must not be made to fetch arbitrary addresses on their behalf — so
 * anything not on this list is refused without a request being made.
 */
const GOOGLE_HOSTS = new Set([
  'maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com', 'google.com',
  'maps.googleapis.com', 'www.google.com.lb', 'google.com.lb',
])

/** Google's country domains — google.fr/maps and the like. */
const GOOGLE_CCTLD = /^(?:www\.)?google\.(?:[a-z]{2,3})(?:\.[a-z]{2})?$/i

export function allowedMapsHost(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    return GOOGLE_HOSTS.has(host) || GOOGLE_CCTLD.test(host)
  } catch { return false }
}

/** A short link carries no coordinates; it has to be followed to be read. */
export function isShortLink(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host === 'maps.app.goo.gl' || host === 'goo.gl'
  } catch { return false }
}

const num = String.raw`(-?\d+\.\d+)`

// Ordered by how much each shape is to be trusted: the pin Google records in
// the link beats the centre of the view it happened to be showing.
const PATTERNS = [
  new RegExp(`!3d${num}!4d${num}`),                                   // the pin itself
  new RegExp(`[?&](?:q|ll|daddr|center|destination)=${num},\\s*${num}`, 'i'),
  new RegExp(`/(?:search|place|dir)/${num},\\s*${num}`, 'i'),
  new RegExp(`@${num},${num}`),                                       // the view centre
]

/**
 * The coordinates in a link — or in a bare "33.88, 35.51" an agent copied out
 * of the app, which is the other thing that gets pasted into a box like this.
 */
function rawLatLng(s: string): LatLng | null {
  for (const re of PATTERNS) {
    const m = re.exec(s)
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
  }
  // A pasted coordinate pair on its own, with a comma or whitespace between.
  const bare = new RegExp(`^${num}\\s*[, ]\\s*${num}$`).exec(s)
  return bare ? { lat: parseFloat(bare[1]), lng: parseFloat(bare[2]) } : null
}

export function parseLatLng(input: string | null | undefined): LatLng | null {
  const point = rawLatLng(String(input ?? '').trim())
  return point && inLebanon(point) ? point : null
}

export type LinkVerdict =
  | { kind: 'point'; point: LatLng }        // read it here, no request needed
  | { kind: 'expand'; url: string }         // a short link: follow it
  | { kind: 'error'; error: string }

/**
 * What to do with what was pasted, decided before anything is fetched.
 *
 * The error messages name the fix, because the agent is standing in a flat with
 * one hand on their phone: "that link has no location in it" is useless unless
 * it also says what to send instead.
 */
export function readMapsPaste(raw: string | null | undefined): LinkVerdict {
  const s = String(raw ?? '').trim()
  if (!s) return { kind: 'error', error: 'Paste a Google Maps link.' }

  // A link is checked for where it comes from BEFORE it is read, so a URL from
  // anywhere else is refused outright rather than quietly mined for numbers.
  if (/^https?:\/\//i.test(s)) {
    if (!allowedMapsHost(s)) {
      return { kind: 'error', error: 'Only Google Maps links can be read. Open the place in Google Maps, tap Share, and paste that.' }
    }
    const point = rawLatLng(s)
    if (point && inLebanon(point)) return { kind: 'point', point }
    if (point) return { kind: 'error', error: 'That place is outside Lebanon — check you shared the right one.' }
    if (isShortLink(s)) return { kind: 'expand', url: s }
    // A Google link with no coordinates in it — a search results page, usually.
    return { kind: 'error', error: 'That link has no location in it. Tap the place in Google Maps first, then Share.' }
  }

  const point = rawLatLng(s)
  if (point && inLebanon(point)) return { kind: 'point', point }
  if (point) return { kind: 'error', error: 'That place is outside Lebanon — check you copied the right coordinates.' }

  return { kind: 'error', error: 'That does not look like a link. Share the place from Google Maps and paste what it gives you.' }
}
