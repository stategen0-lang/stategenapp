// Deciding what to do with an area spelling already in the database.
//
// Split out of scripts/canonicalise-areas.mjs so the rules can be tested
// without a database — this decides what gets rewritten in a manager's real
// records, so "it looked right when I ran it" is not good enough.
//
// The one rule that matters: only a CONFIDENT resolution is ever applied, the
// same bar the listing form uses before it corrects an agent's typing. A name
// several places share, and a name the gazetteer has never heard of, are
// reported and left exactly as they are. This never guesses.

import type { Area, AreaIndex } from './areas-core.ts'
import { resolveArea } from './areas-core.ts'

export type Verdict =
  | { verdict: 'ok' }
  | { verdict: 'change'; to: string }
  | { verdict: 'ambiguous'; candidates: Area[] }
  | { verdict: 'unknown' }

/** What should happen to one spelling. */
export function areaVerdict(ix: AreaIndex, raw: string): Verdict {
  const text = String(raw ?? '').trim()
  if (!text) return { verdict: 'ok' }
  const found = resolveArea(ix, text)
  if (!found) return { verdict: 'unknown' }
  if (!found.confident) return { verdict: 'ambiguous', candidates: found.candidates.slice(0, 3) }
  if (found.area.name === text) return { verdict: 'ok' }
  return { verdict: 'change', to: found.area.name }
}

/** Every area named in a cell. One cell can hold several, comma-separated. */
export function areaTokens(value: unknown): string[] {
  return String(value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Rewrite a cell, keeping the order and every part we are not sure about.
 *
 * "Ashrafiyeh, Hadath, behind the mill" becomes "Achrafieh, Hadath, behind the
 * mill" — the one we are certain of is corrected and the other two are carried
 * through untouched, because a cleanup that quietly drops what it cannot place
 * is a cleanup nobody can trust.
 */
export function rewriteAreaCell(
  ix: AreaIndex,
  value: unknown,
  decide: (raw: string) => Verdict = raw => areaVerdict(ix, raw),
): { text: string; changed: boolean } {
  const parts = areaTokens(value)
  const original = String(value ?? '')
  if (!parts.length) return { text: original, changed: false }

  const text = parts.map(p => {
    const v = decide(p)
    return v.verdict === 'change' ? v.to : p
  }).join(', ')

  return { text, changed: text !== original }
}

/** The same, for a client's `locations` array. */
export function rewriteAreaList(
  ix: AreaIndex,
  list: unknown,
  decide: (raw: string) => Verdict = raw => areaVerdict(ix, raw),
): { list: string[]; changed: boolean } {
  if (!Array.isArray(list)) return { list: [], changed: false }
  const next = list.map(l => {
    const raw = String(l ?? '').trim()
    const v = decide(raw)
    return v.verdict === 'change' ? v.to : String(l ?? '')
  })
  return { list: next, changed: JSON.stringify(next) !== JSON.stringify(list) }
}

// ── Planning a cleanup over real rows ────────────────────────────────────────
// Kept here rather than in the script so the whole plan — which rows change,
// which spellings are reported, what the new values are — can be proved against
// fixtures before it is ever pointed at a manager's database.

export interface PropertyRow { id: number; Location?: unknown; Neighborhood?: unknown }
export interface ClientRow { id: number; 'prefered-location'?: unknown; notes?: unknown }

export interface SpellingReport {
  raw: string
  listings: number
  clients: number
  verdict: Verdict
}

export interface CleanupPlan {
  /** Every distinct spelling found, with what would happen to it. */
  spellings: SpellingReport[]
  propertyEdits: { id: number; Location: string; Neighborhood: string }[]
  clientEdits: { id: number; 'prefered-location': string; notes: string }[]
}

/** Busiest first, so the report opens with what matters most. */
const byUse = (a: SpellingReport, b: SpellingReport) =>
  (b.listings + b.clients) - (a.listings + a.clients) || a.raw.localeCompare(b.raw)

export function planAreaCleanup(
  ix: AreaIndex,
  rows: { properties?: PropertyRow[]; clients?: ClientRow[] },
): CleanupPlan {
  // One verdict per distinct spelling: an agency writes "Achrafieh" a thousand
  // times and resolving it a thousand times would be a thousand times the work.
  const decided = new Map<string, Verdict>()
  const decide = (raw: string): Verdict => {
    let v = decided.get(raw)
    if (!v) { v = areaVerdict(ix, raw); decided.set(raw, v) }
    return v
  }

  const usage = new Map<string, { listings: number; clients: number }>()
  const note = (raw: string, kind: 'listings' | 'clients') => {
    if (!raw) return
    const u = usage.get(raw) ?? { listings: 0, clients: 0 }
    u[kind] += 1
    usage.set(raw, u)
  }

  const propertyEdits: CleanupPlan['propertyEdits'] = []
  for (const p of rows.properties ?? []) {
    for (const t of areaTokens(p.Location)) note(t, 'listings')
    for (const t of areaTokens(p.Neighborhood)) note(t, 'listings')
    const location = rewriteAreaCell(ix, p.Location, decide)
    const neighborhood = rewriteAreaCell(ix, p.Neighborhood, decide)
    if (location.changed || neighborhood.changed) {
      propertyEdits.push({ id: p.id, Location: location.text, Neighborhood: neighborhood.text })
    }
  }

  const clientEdits: CleanupPlan['clientEdits'] = []
  for (const c of rows.clients ?? []) {
    for (const t of areaTokens(c['prefered-location'])) note(t, 'clients')

    let blob: Record<string, unknown> | null = null
    try { blob = JSON.parse(String(c.notes ?? '') || '{}') } catch { blob = null }
    const req = (blob?.req ?? null) as Record<string, unknown> | null
    const list = Array.isArray(req?.locations) ? (req!.locations as unknown[]) : null
    for (const t of list ?? []) note(String(t ?? '').trim(), 'clients')

    const display = rewriteAreaCell(ix, c['prefered-location'], decide)
    const rewritten = list ? rewriteAreaList(ix, list, decide) : null

    if (display.changed || rewritten?.changed) {
      // The display string and the array matching reads must not drift apart.
      const nextBlob = blob
        ? { ...blob, req: { ...(req ?? {}), ...(rewritten ? { locations: rewritten.list } : {}) } }
        : null
      clientEdits.push({
        id: c.id,
        'prefered-location': display.text,
        notes: nextBlob ? JSON.stringify(nextBlob) : String(c.notes ?? ''),
      })
    }
  }

  const spellings = [...usage.entries()]
    .map(([raw, u]) => ({ raw, listings: u.listings, clients: u.clients, verdict: decide(raw) }))
    .sort(byUse)

  return { spellings, propertyEdits, clientEdits }
}
