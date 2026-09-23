// node --experimental-strip-types --test src/lib/lebanon/areas.test.mjs
//
// The table of spellings below is the real point of this module: every pair is
// a way two agents in the same agency have written the same place, and every
// one of them used to be a different location as far as matching was concerned.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  foldArea, tightArea, tightAreaWithArticles, skeletonArea,
  buildIndex, resolveArea, resolveRegion, searchAreas, areaLabel, distanceKm,
} from './areas-core.ts'
import { PACKED_AREAS, GOVERNORATES, CAZAS } from './areas.data.ts'

const ix = buildIndex(PACKED_AREAS, GOVERNORATES, CAZAS)

// ── foldArea ─────────────────────────────────────────────────────────────────

test('foldArea: the French and English transliterations meet', () => {
  const same = [
    ['Achrafieh', 'Ashrafiyeh'], ['Achrafieh', 'El Achrafiye'], ['Achrafieh', 'ACHRAFIYEH'],
    ['Hazmieh', 'Hazmiyeh'], ['Jounieh', 'Jounié'], ['Jounieh', 'Juniyeh'],
    ['Chouf', 'Shouf'], ['Zahle', 'Zahleh'], ['Zahle', 'Zahlé'],
    ['Beyrouth', 'Beirut'], ['Ain', 'Ayn'], ['Saida', 'Sayda'],
    ['Deir el Qamar', 'Deir el Kamar'], ['Raouche', 'Rawche'],
    ['Bhamdoun', 'Bhamdun'], ['Zgharta', 'Zgarta'],
  ]
  for (const [a, b] of same) assert.equal(foldArea(a), foldArea(b), `${a} ≠ ${b}`)
})

test('foldArea: the article goes, in every spelling of it', () => {
  // GeoNames writes the sun-letter forms: Ej Jimmaize, Es Sioufi, Er Rmeil.
  assert.equal(foldArea('Jal el Dib'), foldArea('Jal ed Dib'))
  assert.equal(foldArea('Jal el Dib'), foldArea('Jal Dib'))
  assert.equal(foldArea('Ej Jimmaize'), foldArea('Jimmaize'))
  assert.equal(foldArea('El Mazraa'), foldArea('Mazraa'))
  // Unless asked to keep it.
  assert.notEqual(foldArea('Jal el Dib', true), foldArea('Jal Dib', true))
})

test('foldArea: different places stay different', () => {
  const distinct = [
    ['Baabda', 'Baabdat'], ['Hamra', 'Hammana'], ['Jbeil', 'Jbaa'],
    ['Zouk Mosbeh', 'Zouk Mikael'], ['Aley', 'Alma'], ['Sarba', 'Sarada'],
    ['Beit Mery', 'Beit Chabab'], ['Tyre', 'Tayr Debbe'],
  ]
  for (const [a, b] of distinct) assert.notEqual(foldArea(a), foldArea(b), `${a} == ${b}`)
})

test('foldArea: nothing in, nothing out', () => {
  assert.equal(foldArea(''), '')
  assert.equal(foldArea(null), '')
  assert.equal(foldArea(undefined), '')
  assert.equal(foldArea('   '), '')
  assert.equal(foldArea('!!!'), '')
})

test('tightArea: the gap between words is optional', () => {
  assert.equal(tightArea('Kfar Hbab'), tightArea('Kfarhbab'))
  // Run the words together and the article stops being a word, so the plain
  // fold drops it from one spelling and not the other. That is exactly why the
  // article-keeping key exists alongside it.
  assert.notEqual(tightArea('Beit ed Dine'), tightArea('Beiteddine'))
  assert.equal(tightAreaWithArticles('Beit ed Dine'), tightAreaWithArticles('Beiteddine'))
  assert.equal(tightAreaWithArticles('Sin el Fil'), tightAreaWithArticles('sinelfil'))
})

test('skeletonArea: vowels are anyone’s guess in Arabizi', () => {
  assert.equal(skeletonArea('Bhamdoun'), skeletonArea('Bahamdun'))
  assert.equal(skeletonArea('Enfe'), skeletonArea('Anfeh'))
  assert.equal(skeletonArea('Zouq Mkayel'), skeletonArea('Zouk Mikael'))
})

// ── The gazetteer ────────────────────────────────────────────────────────────

test('the data file loads and covers the country', () => {
  assert.ok(ix.areas.length > 3000, `only ${ix.areas.length} areas`)
  assert.ok(ix.areas.filter(a => a.hot).length > 150)
  assert.equal(new Set(ix.areas.map(a => a.slug)).size, ix.areas.length, 'slugs must be unique')
  for (const gov of ['Beirut', 'Mount Lebanon', 'North Lebanon', 'South Lebanon',
                     'Bekaa', 'Nabatieh', 'Akkar', 'Baalbek-Hermel']) {
    assert.ok(ix.areas.some(a => a.governorate === gov), `no areas in ${gov}`)
  }
})

test('resolveArea: the spellings agents actually type', () => {
  const cases = [
    ['achrafieh', 'Achrafieh'], ['Ashrafiyeh', 'Achrafieh'], ['El Achrafiye', 'Achrafieh'],
    ['hazmieh', 'Hazmieh'], ['Hazmiyeh', 'Hazmieh'],
    ['jounieh', 'Jounieh'], ['Jounié', 'Jounieh'], ['juniyeh', 'Jounieh'],
    ['gemmayze', 'Gemmayzeh'], ['Jemmayzeh', 'Gemmayzeh'],
    ['fern el shebbak', 'Furn el Chebbak'], ['furn chebbak', 'Furn el Chebbak'],
    ['jal el dib', 'Jal el Dib'], ['jaldib', 'Jal el Dib'],
    ['sinelfil', 'Sin el Fil'], ['dbaye', 'Dbayeh'], ['kfar hbab', 'Kfarhbab'],
    ['sidon', 'Saida'], ['sour', 'Tyre'], ['trablous', 'Tripoli'],
    ['zahleh', 'Zahle'], ['shweifat', 'Choueifat'], ['rawche', 'Raouche'],
  ]
  for (const [typed, expected] of cases) {
    const r = resolveArea(ix, typed)
    assert.ok(r, `"${typed}" resolved to nothing`)
    assert.equal(r.area.name, expected, `"${typed}" → ${r.area.name}`)
    assert.ok(r.confident, `"${typed}" was not confident enough to correct`)
  }
})

test('resolveArea: the caza is right where agents would notice', () => {
  const cases = [
    ['Achrafieh', 'Beirut'], ['Hazmieh', 'Baabda'], ['Jal el Dib', 'Metn'],
    ['Dbayeh', 'Metn'], ['Sin el Fil', 'Metn'], ['Jounieh', 'Keserwan'],
    ['Broummana', 'Metn'], ['Beit Mery', 'Metn'], ['Bhamdoun', 'Aley'],
    ['Halat', 'Jbeil'], ['Hadath', 'Baabda'], ['Deir el Qamar', 'Chouf'],
  ]
  for (const [name, caza] of cases) {
    assert.equal(resolveArea(ix, name).area.caza, caza, `${name} is not in ${caza}`)
  }
})

test('resolveArea: nothing plausible means null, not a wrong guess', () => {
  assert.equal(resolveArea(ix, ''), null)
  assert.equal(resolveArea(ix, null), null)
  assert.equal(resolveArea(ix, '   '), null)
  assert.equal(resolveArea(ix, 'Kuala Lumpur'), null)
  assert.equal(resolveArea(ix, '12345'), null)
})

test('resolveArea: never rewrites one real place into another', () => {
  // The fold is lossy on purpose, so this guards the one thing it must not do.
  const known = ix.areas.filter(a => a.hot)
  for (const a of known) {
    const r = resolveArea(ix, a.name)
    assert.ok(r, `${a.name} does not resolve to itself`)
    if (r.confident) {
      assert.equal(r.area.name, a.name, `${a.name} was rewritten to ${r.area.name}`)
    }
  }
})

test('searchAreas: the known area comes before the hamlet', () => {
  assert.equal(searchAreas(ix, 'achr')[0].name, 'Achrafieh')
  assert.equal(searchAreas(ix, 'joun')[0].name, 'Jounieh')
  assert.equal(searchAreas(ix, 'hazm')[0].name, 'Hazmieh')
  assert.ok(searchAreas(ix, 'zouk').slice(0, 2).every(a => a.caza === 'Keserwan'))
  assert.ok(searchAreas(ix, 'verd').some(a => a.name === 'Verdun'))
})

test('searchAreas: an empty box offers well-known areas, and nothing overflows', () => {
  const empty = searchAreas(ix, '')
  assert.equal(empty.length, 8)
  assert.ok(empty.every(a => a.hot))
  assert.equal(searchAreas(ix, 'achrafieh', 3)[0].name, 'Achrafieh')
  assert.equal(searchAreas(ix, 'a', 5).length, 5)
  assert.equal(searchAreas(ix, 'Kuala Lumpur').length, 0)
})

test('areaLabel: says where, without repeating itself', () => {
  assert.equal(areaLabel({ name: 'Achrafieh', caza: 'Beirut', governorate: 'Beirut' }), 'Achrafieh · Beirut')
  assert.equal(areaLabel({ name: 'Baabda', caza: 'Baabda', governorate: 'Mount Lebanon' }), 'Baabda · Mount Lebanon')
  assert.equal(areaLabel({ name: 'Somewhere', caza: '', governorate: '' }), 'Somewhere')
})

test('distanceKm: Lebanese distances come out Lebanese', () => {
  const at = n => resolveArea(ix, n).area
  const round = (a, b) => Math.round(distanceKm(at(a), at(b)))
  assert.ok(round('Achrafieh', 'Hamra') <= 5, 'Achrafieh to Hamra should be a few km')
  const jounieh = round('Beirut', 'Jounieh')
  assert.ok(jounieh > 10 && jounieh < 30, `Beirut to Jounieh came out ${jounieh}km`)
  const tripoli = round('Beirut', 'Tripoli')
  assert.ok(tripoli > 60 && tripoli < 100, `Beirut to Tripoli came out ${tripoli}km`)
})

test('resolveRegion: cazas and governorates, however they are spelled', () => {
  const region = q => {
    const r = resolveRegion(ix, q)
    return r ? `${r.kind}:${r.name}` : null
  }
  assert.equal(region('Metn'), 'caza:Metn')
  assert.equal(region('El Metn'), 'caza:Metn')
  assert.equal(region('Matn'), 'caza:Metn')
  assert.equal(region('Keserwan'), 'caza:Keserwan')
  assert.equal(region('Kesrouan'), 'caza:Keserwan')
  assert.equal(region('Chouf'), 'caza:Chouf')
  assert.equal(region('Shouf'), 'caza:Chouf')
  // A governorate wins over a caza of the same name.
  assert.equal(region('Beirut'), 'governorate:Beirut')
  assert.equal(region('Mount Lebanon'), 'governorate:Mount Lebanon')
  // A town is not a region.
  assert.equal(region('Achrafieh'), null)
  assert.equal(region('Dbayeh'), null)
  assert.equal(region(''), null)
  assert.equal(region('Kuala Lumpur'), null)
})

test('the region table is built once and covers every caza', () => {
  assert.ok(ix.byRegion.size >= ix.cazas.length)
  for (const caza of ix.cazas) assert.ok(resolveRegion(ix, caza), `${caza} must resolve`)
  for (const gov of ix.governorates) assert.ok(resolveRegion(ix, gov), `${gov} must resolve`)
})
