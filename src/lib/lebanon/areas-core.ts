// ── Lebanese areas: folding, indexing and lookup ─────────────────────────────
//
// Lebanon has no agreed Latin spelling for its own place names. The same street
// is written Achrafieh, Ashrafiyeh, Achrafiye, El Achrafiye or Ashrafiyah
// depending on whether the agent learnt French, English or typed it in Arabizi.
// Stored as free text, those are five different places: a client asking for
// Hazmieh is never shown a listing filed as Hazmiyeh, because scoreLocation
// finds neither spelling and excludes the match outright.
//
// So every comparison goes through foldArea(), which collapses the French and
// English transliteration conventions onto one key. It is deliberately lossy —
// it is a lookup key, never something shown to anyone.
//
// Pure: no imports, no DOM, no network, so `node --test` covers it directly and
// the data module (3,700 areas) can be loaded separately, only when needed.

export interface Area {
  slug: string
  /** The spelling shown and stored — curated for the areas agents actually use. */
  name: string
  governorate: string
  caza: string
  lat: number
  lng: number
  /** A real-estate area rather than a hamlet: ranked first in suggestions. */
  hot: boolean
  /** Other spellings that resolve here. Not shown, only matched. */
  aliases: string[]
}

// The Arabic article, in every transliteration, including the sun-letter forms
// GeoNames uses ("Ej Jimmaize", "Es Sioufi", "Er Rmeil"). Dropped wherever it
// appears, so "Jal el Dib" and "Jal Dib" are one key.
const ARTICLES = new Set([
  'el', 'al', 'le', 'la', 'il',
  'ej', 'es', 'ech', 'esh', 'en', 'er', 'et', 'ez', 'ed',
  'as', 'ash', 'ad', 'az', 'ar', 'an', 'at',
])

/**
 * A lookup key for a Lebanese place name.
 *
 * Folds the conventions that differ between French and English transliteration
 * (ch/sh, ou/u, y/i, q/k, gh/g, kh/k), the optional trailing -h, and the
 * -ieh/-iye/-iyeh/-iyah ending family, then drops the article.
 *
 *   foldArea('El Achrafiye')  === foldArea('Ashrafiyeh')  // 'ashrafi'
 *   foldArea('Jal el Dib')    === foldArea('Jal ed Dib')  // 'jal dib'
 */
export function foldArea(input: string | null | undefined, keepArticles = false): string {
  let s = String(input ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // drop diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')                        // ` ' - . all become gaps
    .trim()
  if (!s) return ''

  const words = s.split(' ')
    .filter(w => w && (keepArticles || !ARTICLES.has(w)))
    .map(foldWord)
    .filter(Boolean)

  // A name made only of article-like words (rare, but "El Aal" exists) keeps
  // its words rather than folding away to nothing.
  if (!words.length) return s.split(' ').map(foldWord).filter(Boolean).join(' ')
  return words.join(' ')
}

function foldWord(w: string): string {
  let x = w
    .replace(/ch/g, 'sh')      // Chouf / Shouf
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')       // Beyrouth / Beirut
    .replace(/dh/g, 'd')
    .replace(/gh/g, 'g')       // Zgharta
    .replace(/kh/g, 'k')       // Khalde / Kalde
    .replace(/[qc]/g, 'k')     // Qamar / Kamar, Cornet / Kornet
    .replace(/x/g, 'ks')
    .replace(/ou/g, 'u')       // Jounieh / Junieh
    .replace(/oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/w/g, 'u')        // Rawche / Raouche
    .replace(/y/g, 'i')        // Beyrouth / Beirut, Ayn / Ain
    .replace(/h$/, '')         // Zahleh / Zahle
    .replace(/(.)\1+/g, '$1')  // Jimmaize / Jimaize

  // The -ieh / -iye / -iyeh / -iyah / -iyya ending family, all one sound.
  x = x.replace(/i+(e|a)$/, 'i')

  // The final vowel is the least stable letter of all: Zahle / Zahleh / Zahlé,
  // Bcharre / Bsharri, Enfe / Anfeh. Short words keep theirs — dropping it from
  // "Ain" or "Jal" would fold half the country together.
  if (x.length > 3) x = x.replace(/[aeiou]$/, '')

  return x
}

/**
 * The fold with word gaps removed, for the names written both ways —
 * "Kfar Hbab" / "Kfarhbab", "Beit ed Dine" / "Beiteddine".
 *
 * Two forms, because running the words together hides the article from the
 * word-level rules: "Sin el Fil" drops it and gives "sinfil", while someone
 * typing "sinelfil" keeps it. Indexing both makes either spelling findable.
 */
export function tightArea(input: string | null | undefined): string {
  return tighten(foldArea(input))
}

export function tightAreaWithArticles(input: string | null | undefined): string {
  return tighten(foldArea(input, true))
}

// The doubled letter is collapsed again after closing the gaps, because a pair
// that straddled two words survives the word-level pass: "Beit ed Dine" joins
// to "beiteddin" while "Beiteddine" was already "beitedin".
function tighten(folded: string): string {
  return folded.replace(/ /g, '').replace(/(.)\1+/g, '$1')
}

/**
 * The consonant skeleton — a much coarser key for Arabizi, where vowels are
 * anyone's guess ("Bhamdoun" / "Bhamdun" / "Bahamdoun").
 *
 * Only ever used to OFFER a suggestion, never to rewrite what an agent typed:
 * it collides too easily to be trusted on its own.
 */
export function skeletonArea(input: string | null | undefined): string {
  return foldArea(input)
    .split(' ')
    .filter(Boolean)
    // A leading vowel is as unreliable as any other (Enfe / Anfeh), so it is
    // kept only as a marker that the word begins with one.
    .map(w => (/[aeiou]/.test(w[0]) ? 'a' : w[0]) + w.slice(1).replace(/[aeiou]/g, ''))
    .join(' ')
    .trim()
}

// ── The index ────────────────────────────────────────────────────────────────

interface Key { k: string; area: Area; isName: boolean }

export interface AreaIndex {
  areas: Area[]
  /** The 26 cazas and 8 governorates — agents name these as often as a town. */
  cazas: string[]
  governorates: string[]
  /** Every spelling key of those regions, built once. See resolveRegion. */
  byRegion: Map<string, RegionMatch>
  /** fold key → areas. More than one means the name is ambiguous. */
  byFold: Map<string, Area[]>
  /** The same keys without word gaps: "Kfarhbab" finds "Kfar Hbab". */
  byTight: Map<string, Area[]>
  bySkeleton: Map<string, Area[]>
  keys: Key[]
}

/** Parse the packed data file into a searchable index. */
export function buildIndex(packed: string, governorates: string[], cazas: string[]): AreaIndex {
  const areas: Area[] = []
  const byFold = new Map<string, Area[]>()
  const byTight = new Map<string, Area[]>()
  const bySkeleton = new Map<string, Area[]>()
  const keys: Key[] = []

  // Slugs are derived rather than stored: they are just the folded name, and
  // 3,600 of them would be a fifth of this file's weight for nothing.
  const slugs = new Map<string, number>()

  for (const line of packed.split('\n')) {
    if (!line) continue
    const [name, gi, ci, lat, lng, hot, alts] = line.split('\t')
    const base = foldArea(name).replace(/ /g, '-') || 'area'
    const n = (slugs.get(base) ?? 0) + 1
    slugs.set(base, n)

    const area: Area = {
      slug: n === 1 ? base : `${base}-${n}`,
      name,
      governorate: governorates[Number(gi)] ?? '',
      caza: cazas[Number(ci)] ?? '',
      lat: Number(lat),
      lng: Number(lng),
      hot: hot === '1',
      aliases: alts ? alts.split(';') : [],
    }
    areas.push(area)
    indexArea(area, byFold, byTight, bySkeleton, keys)
  }

  // Cazas last so a governorate of the same name wins: someone asking for
  // "Beirut" wants any of its districts, not the point the city is pinned at.
  const byRegion = new Map<string, RegionMatch>()
  for (const [names, kind] of [[cazas, 'caza'], [governorates, 'governorate']] as const) {
    for (const name of names.filter(Boolean)) {
      for (const key of [foldArea(name), tightArea(name), skeletonArea(name)]) {
        if (key) byRegion.set(key, { kind, name })
      }
    }
  }

  return {
    areas,
    cazas: cazas.filter(Boolean),
    governorates: governorates.filter(Boolean),
    byRegion,
    byFold, byTight, bySkeleton, keys,
  }
}

function push(m: Map<string, Area[]>, k: string, a: Area) {
  const at = m.get(k)
  if (at) { if (!at.includes(a)) at.push(a) } else m.set(k, [a])
}

/** Every key an area answers to, added to the four lookup maps. */
function indexArea(
  area: Area,
  byFold: Map<string, Area[]>,
  byTight: Map<string, Area[]>,
  bySkeleton: Map<string, Area[]>,
  keys: Key[],
) {
  for (const [spelling, isName] of [[area.name, true] as const, ...area.aliases.map(a => [a, false] as const)]) {
    const f = foldArea(spelling)
    if (!f) continue
    keys.push({ k: f, area, isName })
    push(byFold, f, area)
    push(byTight, tightArea(spelling), area)
    push(byTight, tightAreaWithArticles(spelling), area)
    push(bySkeleton, skeletonArea(spelling), area)
  }
}

/**
 * The built-in gazetteer plus places an agency has taught the app.
 *
 * Lebanon has more named places than any dump contains — an agent's "Hbous" is
 * real even when GeoNames has never heard of it — so when someone drops a pin
 * on one it is remembered and used from then on, for suggestions and for
 * matching alike.
 *
 * Returns a NEW index; the shared one is never mutated. That matters on the
 * server, where one process answers for every agency: a place one agency taught
 * must not leak into another's matching. The maps are copied (about 3,600
 * entries, roughly a millisecond) rather than rebuilt from the packed string.
 *
 * A learned area never overrides a built-in one — it is pushed onto the same
 * key, so an ambiguous name stays ambiguous and nothing already correct moves.
 */
export function extendIndex(base: AreaIndex, extra: Area[]): AreaIndex {
  if (!extra.length) return base

  const byFold = new Map(base.byFold)
  const byTight = new Map(base.byTight)
  const bySkeleton = new Map(base.bySkeleton)
  // The value arrays are shared with the base index, so they are copied on the
  // way past — otherwise pushing onto one would edit the shared gazetteer.
  for (const m of [byFold, byTight, bySkeleton]) {
    for (const [k, v] of m) m.set(k, [...v])
  }
  const keys = [...base.keys]
  const areas = [...base.areas]

  for (const area of extra) {
    areas.push(area)
    indexArea(area, byFold, byTight, bySkeleton, keys)
  }

  return { ...base, areas, byFold, byTight, bySkeleton, keys }
}

// ── Lookup ───────────────────────────────────────────────────────────────────

export interface Resolution {
  area: Area
  /**
   * True when the input maps to exactly one area and may be rewritten to its
   * canonical spelling. False when the fold is shared by several places (three
   * villages are called Hadath) or only the skeleton matched — then it is a
   * suggestion the agent confirms, and whatever they typed still stands.
   */
  confident: boolean
  /** Every candidate, when the name is ambiguous. */
  candidates: Area[]
}

/** Resolve a typed area to a canonical one. Null when nothing plausible matches. */
export function resolveArea(ix: AreaIndex, input: string | null | undefined): Resolution | null {
  const f = foldArea(input)
  if (!f) return null

  const exact = ix.byFold.get(f)
  if (exact?.length) return decide(exact)

  const tight = ix.byTight.get(tightArea(input)) ?? ix.byTight.get(tightAreaWithArticles(input))
  if (tight?.length) return decide(tight)

  const skel = ix.bySkeleton.get(skeletonArea(input))
  if (skel?.length) {
    const ranked = [...skel].sort(rankArea)
    return { area: ranked[0], confident: false, candidates: ranked }
  }

  return null
}

/**
 * Several places share a name — Lebanon has a Hadath in Baabda and another in
 * Jbeil, a Bhamdoun town and a Bhamdoun station. Rewriting what an agent typed
 * is still safe when one of them is a known area and the rest are hamlets, or
 * when they are all spelled the same anyway and only the map pin differs.
 */
function decide(found: Area[]): Resolution {
  const ranked = [...found].sort(rankArea)
  const sameName = ranked.every(a => a.name === ranked[0].name)
  const confident = ranked.length === 1 || sameName || ranked.filter(a => a.hot).length === 1
  return { area: ranked[0], confident, candidates: ranked }
}

export interface RegionMatch {
  kind: 'caza' | 'governorate'
  name: string
}

/**
 * Is this text the name of a region rather than a place?
 *
 * Agents say "Metn" and "Keserwan" as readily as "Jal el Dib", and those are
 * not populated places — GeoNames has no such row. Left to the place lookup,
 * "Metn" reached a mountain village called El Mtain through the consonant
 * skeleton, and a client asking for the whole caza was scored on how far a
 * listing was from that village. So regions are resolved first, against the
 * closed list of 26 cazas and 8 governorates, where a loose match is safe.
 */
export function resolveRegion(ix: AreaIndex, input: string | null | undefined): RegionMatch | null {
  const f = foldArea(input)
  if (!f) return null
  // Three lookups in a table built once. Folding all 34 region names on every
  // call cost about 400,000 string operations to score a thousand clients.
  return ix.byRegion.get(f)
    ?? ix.byRegion.get(tightArea(input))
    ?? ix.byRegion.get(skeletonArea(input))
    ?? null
}

/** The governorate a caza belongs to, from the areas filed under it. */
export function governorateOf(ix: AreaIndex, caza: string): string {
  return ix.areas.find(a => a.caza === caza)?.governorate ?? ''
}

/** Known real-estate areas first, then shorter names (the town before the hamlet). */
function rankArea(a: Area, b: Area): number {
  if (a.hot !== b.hot) return a.hot ? -1 : 1
  return a.name.length - b.name.length
}

/**
 * Type-ahead suggestions, best first: exact spelling, then names starting with
 * what was typed, then aliases, then anything containing it.
 */
export function searchAreas(ix: AreaIndex, query: string | null | undefined, limit = 8): Area[] {
  const f = foldArea(query)
  if (!f) return ix.areas.filter(a => a.hot).sort(rankArea).slice(0, limit)

  const scored = new Map<Area, number>()
  for (const { k, area, isName } of ix.keys) {
    let score: number
    if (k === f) score = isName ? 0 : 1
    else if (k.startsWith(f)) score = isName ? 2 : 3
    else if (k.includes(f)) score = isName ? 4 : 5
    else continue
    // Being a place people actually list property in outweighs one tier of
    // text match: typing "zouk" should offer Zouk Mikael before a hamlet in
    // Akkar that happens to be spelled exactly "Zouq".
    if (!area.hot) score += 3
    const prev = scored.get(area)
    if (prev === undefined || score < prev) scored.set(area, score)
  }

  return [...scored.entries()]
    .sort((x, y) => x[1] - y[1] || rankArea(x[0], y[0]))
    .slice(0, limit)
    .map(e => e[0])
}

/** "Achrafieh · Beirut" — the caza disambiguates the many repeated village names. */
export function areaLabel(a: Area): string {
  const where = a.caza && a.caza !== a.name ? a.caza : a.governorate
  return where ? `${a.name} · ${where}` : a.name
}

/** Straight-line kilometres between two areas. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111
  const dLng = (a.lng - b.lng) * 111 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}
