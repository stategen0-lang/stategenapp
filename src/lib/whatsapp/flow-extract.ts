// Conversational field extraction for the add-listing / add-client flow.
//
// While a create flow is open, every reply is read as natural language: pull
// whatever CRM fields the agent mentioned (a bare "500k" answers the field they
// were just asked; a rich "for sale, 3 beds, balcony" fills several at once).
//
// Lazy xai import (like intent.ts) so parseFieldsJson stays unit-testable under
// the type-stripping Node runner, which doesn't resolve the "@/" alias.

export type CreateFlow = 'create_property' | 'create_client'

/** A value the model may return for a field. Arrays carry multi-area briefs. */
export type ExtractedValue = string | number | boolean | string[]

const PROPERTY_KEYS =
  'type (apartment/villa/office/shop/land/building/chalet/showroom), transaction ("For Sale" or "For Rent"), ' +
  'location (the area/neighbourhood, ONE place e.g. "Achrafieh" — not a separate city), price (USD number), rent (USD per month number), ' +
  'beds, baths, size (sqm), parkings, ownerName, ownerContact (phone), view, notes'

const CLIENT_KEYS =
  'name, phone, clientType ("buyer" or "renter"), propertyType (apartment/villa/studio/office/shop/land/…), ' +
  'locations (ARRAY of the areas they want, e.g. ["Zouk","Kaslik"]), budget (USD number), ' +
  'beds, baths, parkings, size (sqm number), view, furnishing ("Furnished"/"Semi-furnished"/"Unfurnished"), ' +
  'floor ("Ground level"/"Mid floor"/"Last floor"), balcony (true/false), ' +
  'advancedPayment (true if they can pay months up front), notes (everything else worth keeping)'

// Lebanese agents write briefs in Arabizi — Arabic in Latin letters, with digits
// for sounds that have no Latin letter (3=ع, 5/7=خ/ح, 2=ء). Without this the
// model silently drops half of every real brief.
const ARABIZI = [
  `Agents write Lebanese Arabic in Latin letters ("Arabizi"), mixed with English/French. Common words:`,
  `bado/bada/badda/baddo = wants · badda tkoun/ykoun = wants it to be · hiye = she · huwe = he · hene = they`,
  `ebna/ebnna = her son · bent = daughter · 3omro/3omra = aged · sene/years = years old · w = and`,
  `eza = if · bs = but · ma 3ando/ma 3anda mechkle = he/she doesn't mind · ma fi = there isn't`,
  `chi = about/around · ktir = very/much · ma ma3o/ma ma3a wa2et = doesn't have much time (urgent)`,
  `2arib/2areb min = close to · b3id 3an = far from · fo2 = above · ta7t = below · 7ad = next to`,
  `ndif = clean/tidy · jdid = new · 3mar/3imara jdid = new building · sekne = living/resides`,
  `ma7al = shop · mad5al = entrance · bineye = building · aleb/2aleb = inside · GF = ground floor`,
  `ten2ol/tn2ol = to move/relocate · 3melna showing = we did a viewing`,
].join('\n')

const CLIENT_RULES = [
  `Rules for a client brief:`,
  `- A budget RANGE means the most they'll pay: "400$ - 450$" -> 450, "450$ -400$" -> 450, "up to 600$" -> 600.`,
  `- Rent budgets are monthly and small: "Budget: 450$" for a renter is 450, NEVER 450000.`,
  `- Several areas -> the "locations" ARRAY: "Zouk - Kaslik - Aintoura" -> ["Zouk","Kaslik","Aintoura"].`,
  `- A bedroom range takes the LOWER end (the minimum they'd accept): "1 or 2 bedrooms" -> beds 1.`,
  `- "at least 50 sqm" -> size 50.`,
  `- Anything that is NOT a field — family/occupation, "prime location", "not close to the beach",`,
  `  "no GF", "far from the highway", urgency — goes into "notes", kept close to the agent's words.`,
  `- An EXCLUSION is never a preference: "No GF" is a note, not floor:"Ground level".`,
  `- A placeholder name ("woman", "a client") is still the name; don't invent one.`,
].join('\n')

function systemPrompt(flow: CreateFlow, askedLabel?: string): string {
  const keys = flow === 'create_property' ? PROPERTY_KEYS : CLIENT_KEYS
  const noun = flow === 'create_property' ? 'a property listing' : 'a client / lead'
  return [
    `A real-estate agent is adding ${noun} by chatting on WhatsApp.`,
    `Extract any of these fields from the agent's message and reply with a SINGLE JSON object {"fields":{...}} and nothing else.`,
    `Use ONLY these keys (omit any you can't fill, never invent a value): ${keys}.`,
    askedLabel ? `The agent was just asked for "${askedLabel}", so a bare value (e.g. "500k", "achrafieh", "for sale") answers that.` : '',
    `Money is a plain USD number: "500k" -> 500000, "1.2m" -> 1200000, "2000/month" -> 2000 (and set the rent/renter case).`,
    `Read through typos and casual phrasing.`,
    ARABIZI,
    flow === 'create_client' ? CLIENT_RULES : '',
    ``,
    `Examples:`,
    `"3 bed apartment in Hamra Beirut for sale 450k, 180sqm" -> {"fields":{"type":"apartment","transaction":"For Sale","location":"Hamra","price":450000,"beds":3,"size":180}}`,
    `"500k" -> {"fields":{"price":500000}}`,
    `"for rent, 1800 a month" -> {"fields":{"transaction":"For Rent","rent":1800}}`,
    `"owner is Joe Khoury 03 123456" -> {"fields":{"ownerName":"Joe Khoury","ownerContact":"03 123456"}}`,
    `"renter, budget 2000" -> {"fields":{"clientType":"renter","budget":2000}}`,
    // Real briefs from the agency — the shapes the bot actually receives.
    flow === 'create_client' ? [
      `"Dana Tohme / Request: apartment for rent / Prefer unfurnished / Location: prefer in Zakrit-or Zouk -Kaslik -Aintoura / Hiye w Ebna 3omro 13 years / Bada chi 2 bedrooms 2 bathrooms / Eza studio ma 3anda mechkle bs Lyom 3melna showing / W eza Gf ykoun l mad5al mn aleb l bineye"`,
      ` -> {"fields":{"name":"Dana Tohme","clientType":"renter","propertyType":"apartment","locations":["Zakrit","Zouk","Kaslik","Aintoura"],"furnishing":"Unfurnished","beds":2,"baths":2,"notes":"She and her 13-year-old son. A studio is acceptable; showing done today. If ground floor, entrance must be from inside the building."}}`,
      `"Mikeal Brahim / Apartment for rent / Furnished / Hene new married Couple / Budget: 400$ - 450$ / Ma 3ando mechkle eza studio / Fo2 l autostrade - bado ykoun b3id 3an Highway / Payment method: max 3 months ahead prefer less"`,
      ` -> {"fields":{"name":"Mikeal Brahim","clientType":"renter","propertyType":"apartment","furnishing":"Furnished","budget":450,"advancedPayment":true,"notes":"Newly married couple. Studio acceptable. Above the highway but wants to be far from it. Can pay max 3 months ahead, prefers less."}}`,
      `"Pascale Bou Chaaya / +961 76 099 942 / Request: store for rent / Location : only in zouk Mikael / Ykoun prime location / Budget: up to 600$ / Ykoun at least 50 sqm / 3anda ma7al copy center bada ten2ol"`,
      ` -> {"fields":{"name":"Pascale Bou Chaaya","phone":"+961 76 099 942","clientType":"renter","propertyType":"shop","locations":["Zouk Mikael"],"budget":600,"size":50,"notes":"Must be a prime location. She runs a copy-center shop and wants to relocate."}}`,
      `"Manale Laadam / Apartment for rent / Location: Jounieh- Ghazir -Zouk- Dbayeh / 3mar jdid / 1 bedrooms or 2 bedrooms / Balcony / Hiye Sekne b Adma Bada tkoun chi ndif / Budget: 450$ -400$ / Unfurnished / No GF / Prefer With a sea view / Ma ma3a ktir wa2et"`,
      ` -> {"fields":{"name":"Manale Laadam","clientType":"renter","propertyType":"apartment","locations":["Jounieh","Ghazir","Zouk","Dbayeh"],"beds":1,"balcony":true,"view":"Sea","furnishing":"Unfurnished","budget":450,"notes":"New building. 1-2 bedrooms. Currently lives in Adma, wants somewhere clean. She and her 11-year-old son. No ground floor. In a hurry."}}`,
      `"1-Name of client : woman / 2-Request sale or rent : rent / 3-Areas interests: 5mins up from batroun  2 br / 4-Budget range: 1250 / 5-Comment keep in mind : not close to the beach"`,
      ` -> {"fields":{"name":"woman","clientType":"renter","locations":["Batroun"],"beds":2,"budget":1250,"notes":"About 5 minutes up from Batroun. Not close to the beach."}}`,
    ].join('\n') : '',
  ].filter(Boolean).join('\n')
}

/**
 * Pull the fields object out of a model reply. Tolerant of prose/code fences and
 * of a model that returns the flat fields object without the {"fields":…} wrapper.
 * Returns only plain string/number/boolean values. Pure — unit-tested.
 */
export function parseFieldsJson(raw: string | null | undefined): Record<string, ExtractedValue> {
  if (!raw) return {}
  let text = String(raw).trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  text = text.slice(start, end + 1)

  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) } catch { return {} }

  const raw2 = (parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields))
    ? (parsed.fields as Record<string, unknown>)
    : parsed
  const out: Record<string, ExtractedValue> = {}
  for (const [k, v] of Object.entries(raw2)) {
    if (k === 'fields') continue
    if (typeof v === 'string') { const t = v.trim(); if (t) out[k] = t }
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
    // A client can want several areas, so a list of STRINGS is a legitimate
    // value ("Zouk - Kaslik - Aintoura" -> ["Zouk","Kaslik","Aintoura"]).
    // Anything else in an array is junk and the whole field is dropped.
    else if (Array.isArray(v)) {
      const list = v.filter((x): x is string => typeof x === 'string')
        .map(x => x.trim()).filter(Boolean)
      if (list.length) out[k] = list
    }
  }
  return out
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('extract timed out')), Math.max(ms, 1))),
  ])
}

/** Ask Grok to pull fields from a free-text reply. Returns {} on any failure so
 *  the flow always falls back to direct coercion of the asked field. */
export async function extractCreateFields(
  flow: CreateFlow, message: string, askedLabel?: string,
): Promise<Record<string, ExtractedValue>> {
  if (!message || !message.trim()) return {}
  try {
    const { chat } = await import('@/lib/xai')
    const raw = await withDeadline(
      chat(
        [
          { role: 'system' as const, content: systemPrompt(flow, askedLabel) },
          { role: 'user' as const, content: message },
        ],
        { temperature: 0.1, max_tokens: 1500 },
      ),
      9_000,
    )
    return parseFieldsJson(raw)
  } catch {
    return {}
  }
}
