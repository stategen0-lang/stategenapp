// Generate src/lib/lebanon/areas.data.ts from the GeoNames Lebanon dump.
//
//   1. download https://download.geonames.org/export/dump/LB.zip and unzip it
//   2. node --experimental-strip-types scripts/gen-areas.mjs path/to/LB.txt
//
// GeoNames is the only free source that covers every Lebanese village, but it
// spells them the 1960s French way — "El Achrafiye", "Ej Jimmaize", "Es Sioufi"
// — which is not what any agent types. So the dump supplies coverage and
// coordinates, and the curated tables below supply the spelling shown in the
// app. The GeoNames form is kept as an alias, so data already in the database
// still resolves.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { foldArea, tightArea, skeletonArea } from '../src/lib/lebanon/areas-core.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'src', 'lib', 'lebanon', 'areas.data.ts')

const GOV = {
  '04': 'Beirut', '05': 'Mount Lebanon', '06': 'South Lebanon', '07': 'Nabatieh',
  '08': 'Bekaa', '09': 'North Lebanon', '10': 'Akkar', '11': 'Baalbek-Hermel',
}

const CAZA_GOV = {
  Beirut: 'Beirut',
  Keserwan: 'Mount Lebanon', Jbeil: 'Mount Lebanon', Metn: 'Mount Lebanon',
  Baabda: 'Mount Lebanon', Aley: 'Mount Lebanon', Chouf: 'Mount Lebanon',
  Tripoli: 'North Lebanon', Batroun: 'North Lebanon', Koura: 'North Lebanon',
  Zgharta: 'North Lebanon', Bcharre: 'North Lebanon', 'Minieh-Danniyeh': 'North Lebanon',
  Akkar: 'Akkar', Baalbek: 'Baalbek-Hermel', Hermel: 'Baalbek-Hermel',
  Zahle: 'Bekaa', 'West Bekaa': 'Bekaa', Rachaya: 'Bekaa',
  Saida: 'South Lebanon', Tyre: 'South Lebanon', Jezzine: 'South Lebanon',
  Nabatieh: 'Nabatieh', Marjayoun: 'Nabatieh', Hasbaya: 'Nabatieh', 'Bint Jbeil': 'Nabatieh',
}

// ── Curation, part 1: Beirut, by GeoNames id ─────────────────────────────────
// Beirut's districts are where the spelling chaos actually costs matches, and
// the ids are stable, so these are pinned exactly.
const BY_ID = {
  280446:  { name: 'Achrafieh', aliases: ['Ashrafieh', 'Achrafiyeh', 'Ashrafiyeh', 'Achrafiye'] },
  6274938: { name: 'Gemmayzeh', aliases: ['Gemmayze', 'Jemmayzeh', 'Gemayze', 'Jemmayze'] },
  6274905: { name: 'Hamra' },
  8505283: { name: 'Verdun' },
  8505437: { name: 'Badaro' },
  6274907: { name: 'Raouche', aliases: ['Rawche', 'Rouche', 'Rawsheh'] },
  6274904: { name: 'Ras Beirut', aliases: ['Ras Beyrouth', 'Ras Bayrut'] },
  7838979: { name: 'Mar Mikhael', aliases: ['Mar Mkhayel', 'Mar Michael', 'Mar Mikhayel'] },
  7838968: { name: 'Sassine', aliases: ['Sassine Square', 'Sagesse'] },
  8505435: { name: 'Sodeco' },
  6274958: { name: 'Sioufi', aliases: ['Es Sioufi', 'Siyoufi'] },
  6274966: { name: 'Karm el Zeitoun', aliases: ['Karm ez Zaitoun', 'Karmel Zeitoun'] },
  6275259: { name: 'Tarik el Jdideh', aliases: ['Tariq ej Jdide', 'Tarik Jdideh'] },
  8505223: { name: 'Koraytem', aliases: ['Qoraitem', 'Koreitem'] },
  6275211: { name: 'Kantari', aliases: ['Qantari'] },
  270499:  { name: 'Minet el Hosn' },
  6274963: { name: 'Karantina', aliases: ['Quarantaine'] },
  279422:  { name: 'Mazraa', aliases: ['El Mazraa', 'Mazraah'] },
  6275268: { name: 'Msaytbeh', aliases: ['Mousaitbeh', 'Al Musaytbah', 'Msaitbe'] },
  278007:  { name: 'Saifi', aliases: ['As Sayfi', 'Saifi Village'] },
  6274942: { name: 'Furn el Hayek', aliases: ['Fourn el Hayek'] },
  7838991: { name: 'Furn el Chebbak', aliases: ['Furn el Shebbak', 'Fern el Chebbak'] },
  6274915: { name: 'Ramlet el Baida', aliases: ['Ramlet el Bayda', 'Ramlet al Baida'] },
  265756:  { name: 'Zokak el Blat', aliases: ['Zuqaq al Balat'] },
  6275215: { name: 'Zarif', aliases: ['Ez Zarif'] },
  268756:  { name: 'Ras el Nabaa', aliases: ['Ras en Nabaa'] },
  8505217: { name: 'Manara', aliases: ['El Manara', 'Corniche'] },
  6275227: { name: 'Ain el Mreisseh', aliases: ['Ain el Mraisse', 'Ayn al Muraysa'] },
  6275219: { name: 'Wadi Abou Jmil', aliases: ['Ouadi Bou Jmil', 'Wadi Abu Jamil'] },
  6275228: { name: 'Geitawi', aliases: ['Ej Jeitaoui', 'Jeitawi'] },
  278422:  { name: 'Rmeil', aliases: ['Er Rmeil'] },
  6275213: { name: 'Tallet el Druze', aliases: ['Tallet ed Drouz'] },
  7839309: { name: 'Tallet el Khayat', aliases: ['Tallet el Khayyat'] },
  6274910: { name: 'Sakiet el Janzir', aliases: ['Saqiet ej Janzir'] },
  6274913: { name: 'Burj Abi Haidar', aliases: ['Borj Abou Haidar'] },
  6274912: { name: 'Mar Elias' }, 6274961: { name: 'Mar Mitr' },
  6274911: { name: 'Unesco' },    280332:  { name: 'Bachoura' },
  7838983: { name: 'Tayouneh' },  6274916: { name: 'Sabra' },
  6274906: { name: 'Chatila' },   6274936: { name: 'Beirut Souks', aliases: ['El Maarad', 'Downtown', 'Solidere', 'Beirut Central District'] },
  276781:  { name: 'Beirut', aliases: ['Beyrouth', 'Bayrut'] },
}

// Grouped by caza, because the dump cannot supply one: GeoNames leaves admin2
// empty on 3,714 of its 3,722 Lebanese places, and its caza "seats" sit far
// enough from the towns that nearest-seat put Baabda in Aley and Sin el Fil in
// Keserwan. These curated towns are the reference points instead — every
// village takes the caza of the nearest one, which is a far denser and more
// accurate net than 26 dubious coordinates.
const TOWNS = {
  Keserwan: [
    ['Jounieh', ['Jounié', 'Juniyah', 'Junieh']], ['Kaslik', ['Kesleek']],
    ['Zouk Mosbeh', ['Zuk Musbih']], ['Zouk Mikael', ['Zouk Mikhael', 'Zouq Mkayel'], 265750],
    ['Adma', []], ['Ghazir', []], ['Tabarja', []], ['Sahel Alma', []],
    ['Haret Sakher', ['Haret Sakhr'], 274446], ['Sarba', []], ['Ballouneh', []],
    ['Kfarhbab', ['Kfar Hbab']], ['Bouar', []], ['Kfardebian', ['Kfardebiane']],
    ['Faraya', ['Faraiya']], ['Mzaar', []], ['Ajaltoun', []], ['Daraoun', []],
    ['Jeita', []], ['Rayfoun', []], ['Faitroun', []],
  ],
  Jbeil: [
    ['Jbeil', ['Byblos', 'Jubayl'], 273203], ['Amchit', ['Aamchit']], ['Halat', []],
    ['Fidar', []], ['Aaqoura', ['Akoura']], ['Laklouk', ['Laqlouq']], ['Blat', []],
  ],
  Metn: [
    ['Dbayeh', ['Dbaye', 'Dbayé']], ['Zalka', ['Zalqa']],
    ['Jal el Dib', ['Jal ed Dib', 'Jall Al Dieb'], 273535], ['Antelias', []],
    // Pinned by id: Rabieh and Rabweh are a kilometre apart and GeoNames files
    // both names on one row, so left to the name match they both landed on it
    // and one of the two disappeared. See WRONG_ALIASES below.
    ['Naccache', ['Nakkache', 'En Naqqach'], 278838], ['Rabieh', ['Rabiyeh'], 6275485],
    ['Rabweh', ['Rabwe', 'Er Raboue'], 278531], ['Mansourieh', ['Mansouriyeh']], ['Mkalles', []],
    ['Dekwaneh', ['Dekouaneh']], ['Sin el Fil', []], ['Horsh Tabet', []],
    ['Jdeideh', ['Jdeidet el Metn', 'Jdaidet el Matn'], 279854], ['Bauchrieh', ['Bouchrieh']],
    ['Bourj Hammoud', ['Burj Hammud']], ['Beit Mery', ['Bayt Miri']],
    ['Broummana', ['Brummana', 'Broumana'], 276377], ['Baabdat', []], ['Bikfaya', []],
    ['Dhour Choueir', ['Dhour el Choueir']], ['Ain Saade', ['Ain Saadeh']], ['Biakout', []],
    ['Mtayleb', ['Mtaileb']], ['Bsalim', []], ['Mazraat Yachouh', ['Mazraat Yachouaa']],
    ['Ain Aar', []], ['Monteverde', []], ['Bhersaf', []], ['Bteghrine', []],
    ['Fanar', []], ['Jouret el Ballout', []],
  ],
  Baabda: [
    ['Baabda', []], ['Hazmieh', ['Hazmiyeh', 'Hazmiye']], ['Hadath', ['Hadeth']],
    ['Louaize', ['Louaizeh']], ['Ain el Remmaneh', ['Ain el Rummaneh']],
    ['Chiyah', ['Shiyah']], ['Ghobeiry', ['Ghobeiri']], ['Haret Hreik', []],
    ['Bir Hassan', []], ['Jnah', []], ['Ouzai', ['Ozai']], ['Borj el Brajneh', []],
    ['Hammana', []],
    ['Bsaba', []], ['Kfarchima', ['Kfarshima']], ['Wadi Chahrour', []],
  ],
  Aley: [
    ['Aley', ['Aaley']], ['Bhamdoun', ['Bhamdun']], ['Sofar', ['Soufar', 'Saoufar'], 268097],
    ['Aramoun', ['Aaramoun'], 278682], ['Khalde', ['Khaldeh']], ['Bchamoun', ['Bshamoun']],
    ['Choueifat', ['Chweifat', 'Chouaifat', 'Shweifat'], 278139],
    ['Souk el Gharb', []], ['Chartoun', []], ['Kahale', []], ['Ain Aanoub', []],
  ],
  Chouf: [
    ['Damour', []], ['Naameh', ['Naame']], ['Jiyeh', ['Jiye']],
    ['Deir el Qamar', ['Deir el Kamar']], ['Beiteddine', ['Beit ed Dine'], 276771],
    ['Baakline', ['Baaklin', 'Baakleen'], 277021], ['Barouk', []],
    ['Kfarhim', ['Kfar Him'], 272861], ['Mechref', []], ['Dibbiyeh', []],
  ],
  Tripoli: [['Tripoli', ['Trablous', 'Tarabulus']], ['Mina', ['El Mina'], 279400]],
  Batroun: [['Batroun', []], ['Chekka', ['Shekka']], ['Hamat', []]],
  Koura: [['Amioun', []], ['Kousba', ['Kosba']], ['Anfeh', ['Enfe'], 278928]],
  Zgharta: [['Zgharta', []], ['Ehden', []]],
  Bcharre: [['Bcharre', ['Bsharri', 'Becharre'], 276359], ['Hasroun', []]],
  Saida: [['Saida', ['Sidon', 'Sayda'], 268064], ['Ghazieh', []]],
  Tyre: [['Tyre', ['Sour', 'Sur']], ['Jouaiya', []]],
  Jezzine: [['Jezzine', []]],
  Nabatieh: [['Nabatieh', ['Nabatiyeh']]],
  Marjayoun: [['Marjayoun', []]],
  'Bint Jbeil': [['Bint Jbeil', ['Bent Jbail'], 276592]],
  Hasbaya: [['Hasbaya', ['Hasbaiya']], ['Chebaa', ['Shebaa']]],
  Zahle: [['Zahle', ['Zahlé', 'Zahleh']], ['Chtaura', ['Chtoura', 'Shtaura']], ['Anjar', []],
          ['Rayak', ['Riyaq']], ['Jdita', []], ['Taanayel', []], ['Ksara', []]],
  'West Bekaa': [['Joub Jannine', []], ['Machghara', []]],
  Rachaya: [['Rachaya', ['Rashaya']]],
  Baalbek: [['Baalbek', ['Balbek']], ['Deir el Ahmar', []]],
  Hermel: [['Hermel', []]],
  Akkar: [['Halba', []], ['Kobayat', ['Qoubaiyat']]],
  'Minieh-Danniyeh': [['Minieh', ['El Minieh']], ['Sir Denniyeh', []]],
}


// ── Parse ────────────────────────────────────────────────────────────────────
const src = process.argv[2]
if (!src) { console.error('usage: gen-areas.mjs path/to/LB.txt'); process.exit(1) }
const lines = fs.readFileSync(src, 'utf8').split('\n')

// Abandoned, historical and destroyed places are not real estate.
const KEEP = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLC', 'PPLX', 'PPLL'])
const SEAT = new Set(['PPLC', 'PPLA', 'PPLA2', 'PPLA3'])
const LATIN = /^[\x20-\x7EÀ-ɏ'‘’`.\- ]+$/

const clean = s => s.replace(/[`'‘’]/g, '').replace(/\s+/g, ' ').trim()

const places = []
for (const line of lines) {
  const c = line.split('\t')
  if (c[6] !== 'P' || !KEEP.has(c[7])) continue

  const name = clean(c[2] || c[1])
  if (!name || name.length > 40 || /[()]/.test(name)) continue
  const gov = GOV[c[10]] ? c[10] : ''
  if (!gov) continue
  const lat = +c[4], lng = +c[5]

  places.push({
    id: Number(c[0]),
    name,
    gov: GOV[gov],
    caza: '',                                    // filled from the curated towns below
    lat: +lat.toFixed(3),
    lng: +lng.toFixed(3),
    hot: SEAT.has(c[7]) || Number(c[14]) > 0,
    aliases: (c[3] || '').split(',').map(clean)
      .filter(s => s && s.length <= 40 && LATIN.test(s) && !/[()]/.test(s))
      // Drop the machine spellings. GeoNames capitalises Latin place names, so
      // an all-lowercase alternate is either a letter-by-letter rendering of the
      // Arabic ("hbwsh" for حبوش, "alrbwt" for الربوة) or a romanisation from
      // another language entirely ("ba lei bei ke", "barubekku"). No agent will
      // ever type one — but they fold down to short consonant keys that collide
      // with the real Latin spelling of a DIFFERENT town, and because the junk
      // alias is then the only holder of that key the match looks certain and
      // the agent's text is silently replaced. "Hbous" became Habbouch, 70 km
      // away, through "hbwsh". Half of all alternates were this.
      .filter(s => s !== s.toLowerCase()),
  })
}

// ── Merge duplicates ─────────────────────────────────────────────────────────
// GeoNames lists Ras Beirut, Ramlet el Baida and others twice. Two entries with
// the same folded name within 3 km are one place; left apart they would make
// every lookup "ambiguous" and block the rewrite that is the point of this.
const byKey = new Map()
const byId = new Map()
const merged = []
for (const p of places) {
  const k = foldArea(p.name)
  const twin = (byKey.get(k) || []).find(q => Math.abs(q.lat - p.lat) < 0.03 && Math.abs(q.lng - p.lng) < 0.03)
  if (twin) {
    twin.aliases.push(p.name, ...p.aliases)
    twin.hot = twin.hot || p.hot
    // The curation tables pin GeoNames ids, so a swallowed id must still lead
    // to the surviving place — Raouche is filed twice and lost its name here.
    byId.set(p.id, twin)
    continue
  }
  if (byKey.has(k)) byKey.get(k).push(p); else byKey.set(k, [p])
  byId.set(p.id, p)
  merged.push(p)
}

const problems = []

// ── Aliases GeoNames files on the wrong row ──────────────────────────────────
// 278531 is الربوة (Rabweh) — that is the only Arabic name on the row — but its
// Latin alternates also carry الرابية (Rabieh), the separate Metn locality a
// kilometre away that GeoNames lists again as 6275485. Left in place, the two
// towns share a fold key and neither can be corrected to with any confidence.
const WRONG_ALIASES = {
  278531: ['Ar Rabiyah', 'Er Rabie', 'Er Rabié', 'Er Râbié'],
}

for (const [id, wrong] of Object.entries(WRONG_ALIASES)) {
  const p = byId.get(Number(id))
  if (!p) { problems.push(`id ${id} has wrong-alias entries but is not in the dump`); continue }
  const drop = new Set(wrong.map(foldArea))
  p.aliases = p.aliases.filter(a => !drop.has(foldArea(a)))
}

// ── Apply curation ───────────────────────────────────────────────────────────

for (const [id, o] of Object.entries(BY_ID)) {
  const p = byId.get(Number(id))
  if (!p) { problems.push(`id ${id} (${o.name}) not in dump`); continue }
  if (o.name !== p.name) p.aliases.push(p.name)
  p.aliases.push(...(o.aliases || []))
  p.name = o.name
  p.caza = 'Beirut'
  p.hot = true
}

// Two passes. Towns that match exactly one place are pinned first; the
// ambiguous ones are then resolved against those, because a town belongs beside
// its neighbours. Picking the "better known" candidate instead put Ain Saade in
// the Chouf — there are two — and that one anchor dragged five southern
// villages into the Metn, which then matched clients looking near Saida.
const deferred = []

for (const [caza, towns] of Object.entries(TOWNS)) {
  const gov = CAZA_GOV[caza]
  for (const [name, aliases, id] of towns) {
    let hits
    if (id) {
      const pinned = byId.get(id)
      if (!pinned) { problems.push(`pinned id ${id} (${name}) not in dump`); continue }
      hits = [pinned]
    } else {
      // Every spelling the dump knows for a place is another chance to match it.
      const spellings = p => [p.name, ...p.aliases]
      const f = foldArea(name), t = tightArea(name), s = skeletonArea(name)
      const pool = merged.filter(p => p.gov === gov)
      hits = pool.filter(p => spellings(p).some(x => foldArea(x) === f))
      if (!hits.length) hits = pool.filter(p => spellings(p).some(x => tightArea(x) === t))
      if (!hits.length) hits = pool.filter(p => spellings(p).some(x => skeletonArea(x) === s))
    }

    if (!hits.length) { problems.push(`no match: ${name} (${caza})`); continue }
    if (hits.length > 1) { deferred.push({ caza, name, aliases, hits }); continue }
    apply(hits[0], name, aliases, caza)
  }
}

function apply(p, name, aliases, caza) {
  if (name !== p.name) p.aliases.push(p.name)
  p.aliases.push(...aliases)
  p.name = name
  p.caza = caza
  p.hot = true
}

for (const { caza, name, aliases, hits } of deferred) {
  const pinned = merged.filter(p => p.caza === caza)
  if (pinned.length) {
    const lat = pinned.reduce((s, p) => s + p.lat, 0) / pinned.length
    const lng = pinned.reduce((s, p) => s + p.lng, 0) / pinned.length
    hits.sort((a, b) =>
      ((a.lat - lat) ** 2 + ((a.lng - lng) * 0.83) ** 2) -
      ((b.lat - lat) ** 2 + ((b.lng - lng) * 0.83) ** 2))
  } else {
    hits.sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || b.aliases.length - a.aliases.length)
  }
  const km = pinned.length
    ? Math.round(Math.hypot((hits[0].lat - hits[1].lat) * 111, (hits[0].lng - hits[1].lng) * 92))
    : 0
  problems.push(`${hits.length} matches: ${name} (${caza}) — took the one nearest its caza, ${km} km from the runner-up`)
  apply(hits[0], name, aliases, caza)
}

// ── Caza for everywhere else ─────────────────────────────────────────────────
// Every remaining village takes the caza of the nearest curated town in its own
// governorate. ~190 well-spread reference points beat GeoNames' 26 seats, which
// are placed oddly enough to have filed Baabda under Aley.
const anchors = merged.filter(p => p.caza)
for (const p of merged) {
  if (p.caza) continue
  let best = null, bestD = Infinity
  for (const a of anchors) {
    if (a.gov !== p.gov) continue
    const d = (a.lat - p.lat) ** 2 + ((a.lng - p.lng) * 0.83) ** 2
    if (d < bestD) { bestD = d; best = a }
  }
  p.caza = best ? best.caza : ''
}

// ── Trim aliases to the ones that actually add a key ──────────────────────────
// Lookup folds before comparing, so "Nu`aymāt" and "Nu'aymat" are already the
// same key. Keeping both would only add weight to a file a phone downloads.
for (const p of merged) {
  const seen = new Set([foldArea(p.name)])
  const skel = skeletonArea(p.name)
  p.aliases = p.aliases.filter(a => {
    const f = foldArea(a)
    if (!f || seen.has(f)) return false
    // For a hamlet nobody lists property in, a spelling the skeleton already
    // reaches is not worth its bytes on a phone: it still resolves, just as a
    // suggestion rather than a silent correction. Known areas keep every
    // spelling, because those are the ones that get typed wrong.
    if (!p.hot && skeletonArea(a) === skel) return false
    seen.add(f)
    return true
  })
}

// ── Emit ─────────────────────────────────────────────────────────────────────
// No slug column: it is the folded name, which the reader derives anyway.
merged.sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || a.name.localeCompare(b.name))
const govs = [...new Set(merged.map(p => p.gov))]
const cazas = [...new Set(merged.map(p => p.caza))]

const rows = merged.map(p => [
  p.name, govs.indexOf(p.gov), cazas.indexOf(p.caza),
  p.lat, p.lng, p.hot ? '1' : '', p.aliases.join(';'),
].join('\t'))

const out = `// GENERATED FILE — do not edit by hand. Run scripts/gen-areas.mjs.
//
// Place names and coordinates from GeoNames (https://www.geonames.org),
// licensed CC BY 4.0. Display spellings are curated in the generator.
//
// Packed as one string deliberately: ${merged.length} object literals cost several
// times this in bytes and parse time, and a phone on a Lebanese mobile
// connection downloads this file.

export const GOVERNORATES = ${JSON.stringify(govs)}

export const CAZAS = ${JSON.stringify(cazas)}

/** One area per line: name, governorate, caza, lat, lng, well-known, aliases. */
export const PACKED_AREAS = ${JSON.stringify(rows.join('\n'))}
`

fs.writeFileSync(OUT, out)

console.log(`areas      ${merged.length}`)
console.log(`well-known ${merged.filter(p => p.hot).length}`)
console.log(`aliases    ${merged.reduce((n, p) => n + p.aliases.length, 0)}`)
console.log(`file       ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`)
if (problems.length) {
  console.log(`\ncuration needs attention (${problems.length}):`)
  for (const p of problems) console.log('  ' + p)
}
