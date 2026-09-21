// Loading the gazetteer.
//
// The data is 3,602 areas — 53 KB over the wire — so it is NOT imported at the
// top of any screen. It arrives through a dynamic import the first time someone
// actually touches an area field, lands in its own chunk, and is then served
// from the service worker cache. Nothing on the dashboard's first paint pays
// for it, which matters on the mobile connections this app runs on.
//
// On the server the same call just loads the module once per process.

import { buildIndex, type AreaIndex } from './areas-core'

let index: AreaIndex | null = null
let pending: Promise<AreaIndex> | null = null

export async function loadAreas(): Promise<AreaIndex> {
  if (index) return index
  if (!pending) {
    pending = import('./areas.data')
      .then(m => (index = buildIndex(m.PACKED_AREAS, m.GOVERNORATES, m.CAZAS)))
      .catch(err => { pending = null; throw err })
  }
  return pending
}

/** The index if it is already in memory — for render paths that cannot await. */
export function loadedAreas(): AreaIndex | null {
  return index
}

export { foldArea, resolveArea, searchAreas, areaLabel, distanceKm } from './areas-core'
export type { Area, AreaIndex, Resolution } from './areas-core'
