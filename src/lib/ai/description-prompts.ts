// Pure prompt-building for AI listing descriptions. No imports, so it can be
// unit-tested in isolation (the generator that calls Grok lives in
// property-description.ts and pulls these in).
//
// Two modes, branched on whether a template is supplied:
//   template mode  — reproduce the template's structure, fill its [placeholders]
//   free-form mode — short marketing copy
//
// NB: Grok is a reasoning model — it spends a large, variable number of tokens
// thinking before it writes, out of the same budget, so the token cap is kept
// generous (a small cap returns "" silently).

export interface DescriptionInput {
  title?: string
  type?: string
  transaction?: string
  price?: number
  rent?: number
  district?: string
  city?: string
  size?: number
  beds?: number
  baths?: number
  garden?: boolean
  balcony?: boolean
  terrace?: boolean
  view?: string
  parkings?: number
  buildingAge?: number
  needsRenovation?: boolean
  advancedPayment?: unknown
  furnishing?: string
  floor?: string
  /** The listing's own tick-boxes: Pool, Air Conditioning, Credit Facilities… */
  amenities?: string[]
  /** The building's: Elevator, Generator, 24/7 Security… */
  buildingFeatures?: string[]
  notes?: string
  /** Selling points the agent wants said out loud (unlike `notes`). */
  publicNotes?: string
}

export interface Prompts {
  systemPrompt: string
  prompt: string
  maxTokens: number
  temperature: number
}

/** Tick-boxes as a readable list, or '' when there are none. */
function list(values: string[] | undefined): string {
  return (values ?? []).map(v => String(v ?? '').trim()).filter(Boolean).join(', ')
}

/** The property facts block both modes share. Only known values are included so
 *  the model never invents a value for a placeholder. */
export function buildFacts(d: DescriptionInput): string {
  const priceStr = d.transaction === 'For Rent'
    ? `USD ${Number(d.rent).toLocaleString()}/month`
    : `USD ${Number(d.price).toLocaleString()}`

  return [
    d.title ? `Title: ${d.title}` : null,
    `Property type: ${d.type}`,
    `Transaction: ${d.transaction} (${d.transaction === 'For Rent' ? 'rental' : 'sale'})`,
    `Price: ${priceStr}`,
    // The area exactly as the agency filed it. Appending the country made every
    // description read "in Ashrafieh, Lebanon", which is not how listings here
    // are written.
    `Location (use this wording, do not add a city or country): ${[d.district, d.city].filter(Boolean).join(', ')}`,
    d.size ? `Size: ${d.size} m²` : null,
    d.beds ? `Bedrooms: ${d.beds}` : null,
    d.baths ? `Bathrooms: ${d.baths}` : null,
    d.parkings ? `Parking spaces: ${d.parkings}` : null,
    d.view ? `View: ${d.view}` : null,
    d.garden ? 'Has a private garden' : null,
    d.balcony ? 'Has a balcony' : null,
    d.terrace ? 'Has a terrace' : null,
    d.furnishing ? `Furnishing: ${d.furnishing}` : null,
    d.floor ? `Floor: ${d.floor}` : null,
    // The tick-boxes an agent fills in. They were missing from the facts
    // entirely, so a flat with a generator, a lift and air conditioning — the
    // three things a Lebanese listing leads with — was described as if it had
    // none of them. The model can only mention what it is told.
    list(d.amenities) ? `Features: ${list(d.amenities)}` : null,
    list(d.buildingFeatures) ? `Building has: ${list(d.buildingFeatures)}` : null,
    d.buildingAge ? `Building age: ${d.buildingAge} years` : null,
    d.needsRenovation ? 'Needs renovation' : null,
    d.advancedPayment ? `Advanced payment: ${d.advancedPayment}` : null,
    // Public notes are written for clients, so the description may say them
    // outright; internal notes stay context the copy must never repeat.
    d.publicNotes ? `Selling points from the agent (include these in the description): ${d.publicNotes}` : null,
    d.notes ? `Agent notes (context only — never quote or reveal these): ${d.notes}` : null,
  ].filter(Boolean).join('\n- ')
}

export function buildPrompts(d: DescriptionInput, template?: string | null): Prompts {
  const facts = buildFacts(d)

  if (template && String(template).trim()) {
    // Template mode — the template dictates structure AND length; no sentence cap.
    return {
      systemPrompt:
        'You fill in real estate listing templates. You reproduce the given template exactly — same sections, ' +
        'headings, line breaks, bullet points and ordering — replacing only the placeholders with real property data. ' +
        'You never add commentary, and you never leave placeholder brackets in the output.',
      prompt: `TEMPLATE (reproduce this structure exactly):
--- BEGIN TEMPLATE ---
${template}
--- END TEMPLATE ---

PROPERTY DATA:
- ${facts}

Rules:
- Follow the template's structure verbatim: keep its section headings, line breaks, bullet lists and their order.
- Replace every [placeholder] with the matching value from PROPERTY DATA. No square brackets may remain.
- Where a placeholder offers a choice (e.g. [Rent / Sale], [Own / Rent]), keep only the option that applies.
- If a line's data is missing or zero (e.g. no parking spaces), omit that whole line. Never invent facts or use "N/A".
- If the template separates master and regular bedrooms but only a total is known, list the total as bedrooms and drop the master line.
- Keep the template's fixed wording as-is; only placeholders change. Choose natural adjectives where the template asks for one.
- Use the real figures for price and size, formatted as in the template.
- Work the agent's selling points into the description naturally, in the template's own voice.
- Never repeat or hint at the agent's internal notes.
- Name the location exactly as given — no country, no added city ("in Ashrafieh", never "in Ashrafieh, Lebanon").
- Never output the "--- BEGIN TEMPLATE ---" / "--- END TEMPLATE ---" lines. They mark the template for you; they are not part of it.
- Output only the finished description — no preamble, no explanation, no markdown code fences.`,
      maxTokens: 4000,
      temperature: 0.4,
    }
  }

  // Free-form mode — short marketing copy.
  return {
    systemPrompt: 'You are a professional real estate copywriter specializing in Lebanese property listings.',
    prompt: `Write a real estate listing description for a Lebanese property.

PROPERTY DATA:
- ${facts}

Rules:
- 2-3 sentences only
- Highlight location appeal using Lebanese context (Beirut lifestyle, mountain views, coastal access, etc.)
- Mention the most attractive features naturally
- End with a subtle call to action
- Do NOT use generic filler phrases like "don't miss this opportunity"
- Work the agent's selling points in naturally
- Never repeat or hint at the agent's internal notes
- Name the location exactly as given — no country, no added city ("in Ashrafieh", never "in Ashrafieh, Lebanon")
- Write in English
- Output the description only, no labels or preamble`,
    maxTokens: 300,
    temperature: 0.7,
  }
}

/**
 * The Arabic version of a finished description.
 *
 * Written from the English AND the property facts, not translated line by line:
 * a literal translation of "Featuring a private garden and sea views" reads
 * like an instruction manual, while a model given the facts writes the sentence
 * an Arabic listing would actually use.
 *
 * Structure is preserved, because a description written from the agency's
 * template is a layout — headings, bullets, line breaks — and the Arabic has to
 * be usable in the same places.
 */
export function buildArabicPrompts(d: DescriptionInput, english: string): Prompts {
  return {
    systemPrompt:
      'You write Arabic real estate listing copy for the Lebanese market. You write in Modern Standard Arabic, ' +
      'the register used in property listings and newspaper advertisements — never a spoken dialect, never a ' +
      'word-for-word translation. You output the Arabic text only.',
    prompt: `Write the Arabic version of this listing description.

ENGLISH DESCRIPTION:
${english}

PROPERTY DATA (for accuracy — do not add anything that is not here):
- ${buildFacts(d)}

Rules:
- Keep the structure exactly: the same sections, headings, bullet points, line breaks and their order.
- Write natural Arabic marketing copy, not a literal translation. Same meaning, same selling points, same length.
- Leave numbers, prices and units in Western digits as they are written here: 250,000$ and 180 م².
- Copy any phone number digit for digit, exactly as it appears in the English, and change nothing about it — not the order, not the spacing, not the + — even though the text around it runs right to left.
- Keep the area's name as it is commonly written in Arabic in Lebanon; if you are not certain of it, leave the Latin spelling.
- Never repeat or hint at the agent's internal notes.
- Output only the Arabic description — no preamble, no English, no explanation, no markdown code fences.`,
    maxTokens: 4000,
    temperature: 0.4,
  }
}

/** Does this text contain Arabic script at all? Guards against a model that answers in English. */
export function hasArabic(text: string | null | undefined): boolean {
  return /[؀-ۿ]/.test(String(text ?? ''))
}

/**
 * Remove the markers that wrap the template in the prompt, in case the model
 * copies them into its answer — it did, so a real listing opened with
 * "--- BEGIN TEMPLATE ---".
 *
 * Anything before BEGIN or after END goes with them: that is the model restating
 * the brief, never the description itself.
 */
export function stripTemplateMarkers(text: string): string {
  let out = String(text ?? '')

  const begin = out.search(/-{2,}\s*BEGIN TEMPLATE\s*-{2,}/i)
  if (begin !== -1) {
    const nl = out.indexOf('\n', begin)
    out = nl === -1 ? '' : out.slice(nl + 1)
  }

  const end = out.search(/-{2,}\s*END TEMPLATE\s*-{2,}/i)
  if (end !== -1) out = out.slice(0, end)

  // Any stray marker line left over (different spacing or casing).
  return out.replace(/^[ \t]*-{2,}\s*(BEGIN|END) TEMPLATE\s*-{2,}[ \t]*$/gim, '').trim()
}
