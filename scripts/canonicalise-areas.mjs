/**
 * Standardise the area spellings already in the database.
 *
 *   node --experimental-strip-types scripts/canonicalise-areas.mjs
 *   node --experimental-strip-types scripts/canonicalise-areas.mjs --apply
 *   node --experimental-strip-types scripts/canonicalise-areas.mjs --company=3
 *
 * New records are canonicalised as they are typed, but everything entered
 * before the gazetteer existed still holds whatever was written that day:
 * Ashrafiyeh, El Achrafiye, Achrafiye. Matching compares areas through the
 * gazetteer now, so those rows still match — but they read badly on a listing,
 * in a title, in an export, and in the email the marketing team receives.
 *
 * DRY RUN BY DEFAULT. It prints every distinct spelling with what it would
 * become, and writes nothing at all unless --apply is passed.
 *
 * Only CONFIDENT corrections are proposed — the same bar the listing form uses
 * before it corrects an agent's typing. A name several places share (there are
 * four Hadaths) and a name the gazetteer has never heard of ("behind the old
 * mill") are reported separately and left exactly as they are. It never guesses.
 *
 * Touches: Properties.Location, Properties.Neighborhood,
 *          client_requests."prefered-location" and notes.req.locations —
 *          the display string and the array matching reads, kept in step.
 *
 * The decisions live in src/lib/lebanon/area-cleanup.ts and are unit-tested;
 * this file is the database around them.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { loadAreas, areaLabel } from '../src/lib/lebanon/areas.ts'
import { planAreaCleanup } from '../src/lib/lebanon/area-cleanup.ts'

const APPLY = process.argv.includes('--apply')
const COMPANY = Number((process.argv.find(a => a.startsWith('--company=')) ?? '').split('=')[1]) || null

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// PostgREST returns 1,000 rows at a time. An agency with more than that would
// have the rest silently skipped, and a report that misses rows is worse than
// no report at all.
async function all(table, columns) {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (COMPANY) q = q.eq('company_id', COMPANY)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

const ix = await loadAreas()

console.log(`Reading ${COMPANY ? `company ${COMPANY}` : 'every company'}…\n`)
const properties = await all('Properties', 'id, company_id, Location, Neighborhood')
const clients = await all('client_requests', 'id, company_id, "prefered-location", notes')

const plan = planAreaCleanup(ix, { properties, clients })

// ── Report ───────────────────────────────────────────────────────────────────
const where = s => [
  s.listings ? `${s.listings} listing${s.listings === 1 ? '' : 's'}` : '',
  s.clients ? `${s.clients} client${s.clients === 1 ? '' : 's'}` : '',
].filter(Boolean).join(', ')

const of = kind => plan.spellings.filter(s => s.verdict.verdict === kind)
const changes = of('change')
const ambiguous = of('ambiguous')
const unknown = of('unknown')

console.log(`${properties.length} listings, ${clients.length} clients, ${plan.spellings.length} distinct spellings.\n`)

if (changes.length) {
  console.log(`WILL CHANGE — ${changes.length} spelling${changes.length === 1 ? '' : 's'}`)
  for (const s of changes) console.log(`  ${s.raw.padEnd(26)} → ${s.verdict.to.padEnd(22)} ${where(s)}`)
  console.log()
}

if (ambiguous.length) {
  console.log(`LEFT ALONE — more than one place has this name (${ambiguous.length})`)
  for (const s of ambiguous) {
    console.log(`  ${s.raw.padEnd(26)} could be ${s.verdict.candidates.map(areaLabel).join(' / ')}   ${where(s)}`)
  }
  console.log()
}

if (unknown.length) {
  console.log(`LEFT ALONE — not a place the gazetteer knows (${unknown.length})`)
  for (const s of unknown) console.log(`  ${s.raw.padEnd(26)} ${where(s)}`)
  console.log()
}

console.log(`${of('ok').length} spelling(s) already correct.`)
console.log(`${plan.propertyEdits.length} listing(s) and ${plan.clientEdits.length} client(s) would be updated.\n`)

// ── Apply ────────────────────────────────────────────────────────────────────
if (!APPLY) {
  console.log('Nothing was written. Re-run with --apply to make these changes.')
  process.exit(0)
}
if (!plan.propertyEdits.length && !plan.clientEdits.length) {
  console.log('Nothing to write.')
  process.exit(0)
}

console.log('Applying…')
let done = 0, failed = 0

for (const e of plan.propertyEdits) {
  const { error } = await db.from('Properties')
    .update({ Location: e.Location, Neighborhood: e.Neighborhood }).eq('id', e.id)
  if (error) { failed++; console.error(`  listing ${e.id}: ${error.message}`) } else done++
}
for (const e of plan.clientEdits) {
  const { error } = await db.from('client_requests')
    .update({ 'prefered-location': e['prefered-location'], notes: e.notes }).eq('id', e.id)
  if (error) { failed++; console.error(`  client ${e.id}: ${error.message}`) } else done++
}

console.log(`\nUpdated ${done} record(s)${failed ? `, ${failed} failed` : ''}.`)
if (failed) process.exitCode = 1
