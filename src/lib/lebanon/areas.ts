// Loading the gazetteer.
//
// The data is 3,602 areas — 53 KB over the wire — so it is NOT imported at the
// top of any screen. It arrives through a dynamic import the first time someone
// actually touches an area field, lands in its own chunk, and is then served
// from the service worker cache. Nothing on the dashboard's first paint pays
// for it, which matters on the mobile connections this app runs on.
//
// On the server the same call just loads the module once per process.

import { buildIndex, type AreaIndex } from './areas-core.ts'

let index: AreaIndex | null = null
let pending: Promise<AreaIndex> | null = null

export async function loadAreas(): Promise<AreaIndex> {
  if (index) return index
  if (!pending) {
    pending = import('./areas.data.ts')
      .then(m => (index = buildIndex(m.PACKED_AREAS, m.GOVERNORATES, m.CAZAS)))
      .catch(err => { pending = null; throw err })
  }
  return pending
}

/** The index if it is already in memory — for render paths that cannot await. */
export function loadedAreas(): AreaIndex | null {
  return index
}

export { foldArea, resolveArea, resolveRegion, governorateOf, searchAreas, areaLabel, distanceKm } from './areas-core.ts'
export type { Area, AreaIndex, Resolution, RegionMatch } from './areas-core.ts'

// ── The agency's own places ──────────────────────────────────────────────────
// The built-in gazetteer plus what this agency has taught the app (migration
// 030). Fetched once per session and merged into a SEPARATE index — the shared
// one is never touched, so nothing leaks between agencies on the server.
//
// A failure here is not fatal: the base gazetteer is still returned, so the
// area field works exactly as it did before, minus the learned places.

let learned: AreaIndex | null = null
let learning: Promise<AreaIndex> | null = null

export async function loadCompanyAreas(): Promise<AreaIndex> {
  if (learned) return learned
  if (!learning) {
    learning = (async () => {
      const base = await loadAreas()
      try {
        const [{ extendIndex }, { learnedAreas }] = await Promise.all([
          import('./areas-core.ts'),
          import('./learned-areas.ts'),
        ])
        const res = await fetch('/api/areas')
        if (!res.ok) return base
        const rows = (await res.json())?.areas
        if (!Array.isArray(rows) || !rows.length) return base
        return extendIndex(base, learnedAreas(rows))
      } catch {
        return base
      }
    })().then(ix => (learned = ix)).catch(() => { learning = null; return loadAreas() })
  }
  return learning
}

/** Called after a new area is taught, so the next lookup sees it. */
export function forgetCompanyAreas(): void {
  learned = null
  learning = null
}

export { extendIndex } from './areas-core.ts'
