// node --experimental-strip-types --test src/lib/lebanon/area-cleanup.test.mjs
//
// These rules decide what gets rewritten in a manager's real records, so the
// thing being proved here is mostly what the cleanup must NOT touch.

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIndex } from './areas-core.ts'
import { PACKED_AREAS, GOVERNORATES, CAZAS } from './areas.data.ts'
import { areaVerdict, areaTokens, rewriteAreaCell, rewriteAreaList, planAreaCleanup } from './area-cleanup.ts'

const ix = buildIndex(PACKED_AREAS, GOVERNORATES, CAZAS)
const v = raw => areaVerdict(ix, raw)

test('corrects a spelling it is certain of', () => {
  assert.deepEqual(v('Ashrafiyeh'), { verdict: 'change', to: 'Achrafieh' })
  assert.deepEqual(v('El Achrafiye'), { verdict: 'change', to: 'Achrafieh' })
  assert.deepEqual(v('hazmiyeh'), { verdict: 'change', to: 'Hazmieh' })
  assert.deepEqual(v('Jounié'), { verdict: 'change', to: 'Jounieh' })
  assert.deepEqual(v('sidon'), { verdict: 'change', to: 'Saida' })
})

test('leaves a spelling that is already right', () => {
  for (const name of ['Achrafieh', 'Jounieh', 'Hazmieh', 'Sin el Fil', 'Batroun']) {
    assert.deepEqual(v(name), { verdict: 'ok' }, name)
  }
  assert.deepEqual(v(''), { verdict: 'ok' })
  assert.deepEqual(v('   '), { verdict: 'ok' })
})

test('leaves anything it does not recognise', () => {
  assert.deepEqual(v('behind the old mill'), { verdict: 'unknown' })
  assert.deepEqual(v('Kuala Lumpur'), { verdict: 'unknown' })
  assert.deepEqual(v('12345'), { verdict: 'unknown' })
})

test('leaves a name that belongs to more than one place', () => {
  // Whatever the gazetteer holds two of, the cleanup must not pick one.
  const shared = ix.areas.filter(a => !a.hot).find(a =>
    ix.areas.filter(b => b.name === a.name).length > 1
    && areaVerdict(ix, a.name).verdict === 'ambiguous')
  if (shared) {
    const res = areaVerdict(ix, shared.name)
    assert.equal(res.verdict, 'ambiguous')
    assert.ok(res.candidates.length > 1)
    assert.ok(res.candidates.length <= 3, 'the report shows a few, not forty')
  }
})

test('a cell of several areas keeps the ones it cannot place', () => {
  // The whole point: correcting one part must not drop the rest.
  const out = rewriteAreaCell(ix, 'Ashrafiyeh, behind the old mill, Jounié')
  assert.equal(out.text, 'Achrafieh, behind the old mill, Jounieh')
  assert.equal(out.changed, true)
})

test('a cell that needs nothing is reported as unchanged', () => {
  assert.deepEqual(rewriteAreaCell(ix, 'Achrafieh'), { text: 'Achrafieh', changed: false })
  assert.deepEqual(rewriteAreaCell(ix, ''), { text: '', changed: false })
  assert.deepEqual(rewriteAreaCell(ix, null), { text: '', changed: false })
  assert.deepEqual(rewriteAreaCell(ix, 'nowhere at all'), { text: 'nowhere at all', changed: false })
})

test('spacing alone is not a change worth writing', () => {
  // "Achrafieh,Hamra" re-joins as "Achrafieh, Hamra" — real, and worth doing
  // once, but it must be reported honestly rather than hidden.
  const out = rewriteAreaCell(ix, 'Achrafieh,Hamra')
  assert.equal(out.text, 'Achrafieh, Hamra')
  assert.equal(out.changed, true)
})

test("a client's locations array is corrected in place", () => {
  const out = rewriteAreaList(ix, ['Ashrafiyeh', 'Jounié', 'somewhere else'])
  assert.deepEqual(out.list, ['Achrafieh', 'Jounieh', 'somewhere else'])
  assert.equal(out.changed, true)

  assert.deepEqual(rewriteAreaList(ix, ['Achrafieh']), { list: ['Achrafieh'], changed: false })
  assert.deepEqual(rewriteAreaList(ix, []), { list: [], changed: false })
  assert.deepEqual(rewriteAreaList(ix, null), { list: [], changed: false })
  assert.deepEqual(rewriteAreaList(ix, 'not an array'), { list: [], changed: false })
})

test('areaTokens: the separators a cell actually uses', () => {
  assert.deepEqual(areaTokens('Achrafieh, Hamra'), ['Achrafieh', 'Hamra'])
  assert.deepEqual(areaTokens('  Achrafieh ,, Hamra '), ['Achrafieh', 'Hamra'])
  assert.deepEqual(areaTokens(''), [])
  assert.deepEqual(areaTokens(null), [])
  assert.deepEqual(areaTokens(undefined), [])
})

test('every correction it proposes is one the form would also make', () => {
  // The cleanup must never be bolder than the live app. Whatever it rewrites,
  // an agent typing the same thing into the listing form gets corrected too.
  const samples = ['Ashrafiyeh', 'El Achrafiye', 'hazmiyeh', 'Jounié', 'sidon', 'sour', 'shweifat', 'jaldib']
  for (const raw of samples) {
    const decision = areaVerdict(ix, raw)
    assert.equal(decision.verdict, 'change', raw)
    // Applying it twice changes nothing the second time.
    assert.deepEqual(areaVerdict(ix, decision.to), { verdict: 'ok' }, `${raw} → ${decision.to} is not stable`)
  }
})

// ── The whole plan, over rows shaped like the real tables ───────────────────

const props = [
  { id: 1, Location: 'Ashrafiyeh', Neighborhood: '' },
  { id: 2, Location: 'Achrafieh', Neighborhood: '' },              // already right
  { id: 3, Location: 'Beirut', Neighborhood: 'El Achrafiye' },     // older two-field row
  { id: 4, Location: 'behind the old mill', Neighborhood: '' },    // unknown
  { id: 5, Location: 'Jounié', Neighborhood: '' },
]
const clients = [
  { id: 10, 'prefered-location': 'Ashrafiyeh, Jounié',
    notes: JSON.stringify({ type: 'Buyer', agentId: 'NH', req: { locations: ['Ashrafiyeh', 'Jounié'], beds: 3 } }) },
  { id: 11, 'prefered-location': 'Achrafieh',
    notes: JSON.stringify({ type: 'Buyer', req: { locations: ['Achrafieh'] } }) },
  { id: 12, 'prefered-location': 'hazmiyeh', notes: 'not json at all' },
]

test('the plan finds every spelling and counts where it is used', () => {
  const plan = planAreaCleanup(ix, { properties: props, clients })
  const find = raw => plan.spellings.find(s => s.raw === raw)

  assert.equal(find('Ashrafiyeh').listings, 1)
  assert.equal(find('Ashrafiyeh').clients, 2)      // display string + locations array
  assert.equal(find('Ashrafiyeh').verdict.verdict, 'change')
  assert.equal(find('Achrafieh').verdict.verdict, 'ok')
  assert.equal(find('behind the old mill').verdict.verdict, 'unknown')

  // Busiest first, so the report opens with what matters. Ties (Ashrafiyeh and
  // Achrafieh are both used three times here) fall back to alphabetical.
  const uses = s => s.listings + s.clients
  for (let i = 1; i < plan.spellings.length; i++) {
    assert.ok(uses(plan.spellings[i - 1]) >= uses(plan.spellings[i]), 'not sorted by usage')
  }
  assert.equal(uses(plan.spellings[0]), 3)
})

test('the plan edits only the rows that need it', () => {
  const plan = planAreaCleanup(ix, { properties: props, clients })
  assert.deepEqual(plan.propertyEdits.map(e => e.id), [1, 3, 5])
  assert.deepEqual(plan.clientEdits.map(e => e.id), [10, 12])

  const three = plan.propertyEdits.find(e => e.id === 3)
  assert.equal(three.Location, 'Beirut')           // untouched, already right
  assert.equal(three.Neighborhood, 'Achrafieh')    // corrected
})

test("a client's display string and matching array are corrected together", () => {
  const plan = planAreaCleanup(ix, { properties: [], clients })
  const ten = plan.clientEdits.find(e => e.id === 10)
  assert.equal(ten['prefered-location'], 'Achrafieh, Jounieh')
  const blob = JSON.parse(ten.notes)
  assert.deepEqual(blob.req.locations, ['Achrafieh', 'Jounieh'])
  // Everything else in the blob survives — this must not eat a client's record.
  assert.equal(blob.type, 'Buyer')
  assert.equal(blob.agentId, 'NH')
  assert.equal(blob.req.beds, 3)
})

test('a client whose notes are not JSON still gets its area fixed', () => {
  const plan = planAreaCleanup(ix, { properties: [], clients })
  const twelve = plan.clientEdits.find(e => e.id === 12)
  assert.equal(twelve['prefered-location'], 'Hazmieh')
  assert.equal(twelve.notes, 'not json at all')    // carried through, not destroyed
})

test('running the plan twice changes nothing the second time', () => {
  const first = planAreaCleanup(ix, { properties: props, clients })
  // Apply it, then re-plan over the result.
  const applied = props.map(p => {
    const e = first.propertyEdits.find(x => x.id === p.id)
    return e ? { ...p, Location: e.Location, Neighborhood: e.Neighborhood } : p
  })
  const appliedClients = clients.map(c => {
    const e = first.clientEdits.find(x => x.id === c.id)
    return e ? { ...c, 'prefered-location': e['prefered-location'], notes: e.notes } : c
  })
  const second = planAreaCleanup(ix, { properties: applied, clients: appliedClients })
  assert.deepEqual(second.propertyEdits, [])
  assert.deepEqual(second.clientEdits, [])
})

test('an empty database plans nothing', () => {
  const plan = planAreaCleanup(ix, {})
  assert.deepEqual(plan.spellings, [])
  assert.deepEqual(plan.propertyEdits, [])
  assert.deepEqual(plan.clientEdits, [])
})
