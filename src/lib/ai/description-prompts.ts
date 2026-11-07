// Pure prompt-building for AI listing descriptions. No imports, so it can be
// unit-tested in isolation (the generator that calls the model lives in
// property-description.ts and pulls these in).
//
// Two modes, branched on whether a template is supplied:
//   template mode  — reproduce the template's structure, fill its [placeholders]
//   free-form mode — short marketing copy
//
// The token caps are output caps: the model runs with thinking off (see
// lib/ai/llm.ts), so every token is description.

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
  /**
   * How the agent wants this draft written, when they asked for a rewrite
   * ("no neighbourhood line", "shorter", "no call to action"). Style only —
   * it can't add facts.
   */
  style?: string
}

export interface Prompts {
  systemPrompt: string
  prompt: string
  maxTokens: number
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
    const rental = d.transaction === 'For Rent'
    // Template mode — the template dictates structure AND length; no sentence cap.
    //
    // Agencies write two kinds of template: one with [placeholders], and — far
    // more often — a finished listing for some other property, pasted as the
    // example. Equity's is a SALE apartment ("Own this 135 SQM … available for
    // sale … Price: 135,000$ + 2.5% Commission"). Told to keep everything but the
    // placeholders, the model kept "Own this" on every rental, the sale
    // commission, and the example's rooms, and dropped facts the example had no
    // line for — the advance payment among them.
    return {
      systemPrompt:
        'You write real estate listings in an agency\'s house style. The agency gives you a template — either a form ' +
        'with [placeholders] or a finished listing for another property — and you write THIS property\'s listing in ' +
        'the same layout, voice and formatting. You output only the listing, never a remark about it.',
      prompt: `TEMPLATE (the agency's house style):
--- BEGIN TEMPLATE ---
${template}
--- END TEMPLATE ---

PROPERTY DATA:
- ${facts}

Rules:
- Follow the template's layout: its sections, headings, line breaks, bullet style and order.
- The template may be a finished listing for a different property. Every specific detail in it — size, area, view, rooms, floor, features, price, the property type, sale or rent — belongs to that example. Replace each with THIS property's data, and drop any line this property has no data for. Never carry an example's detail over.
- Keep the agency's fixed lines exactly as written: the call to action, the contact number, the closing headings.
- Replace every [placeholder] with the matching value from PROPERTY DATA; where one offers a choice ([Own / Rent], [Rent / Sale]) keep the one that applies. No square brackets may remain.
- This property is ${rental ? 'FOR RENT' : 'FOR SALE'}. ${rental
        ? 'Use rental wording throughout: "Rent this …", "available for rent", the price per month. Never "Own this", "for sale" or "buy".'
        : 'Use sale wording throughout: "Own this …", "available for sale". Never "Rent this" or "per month".'}
- Put EVERY fact from PROPERTY DATA in the listing (except the agent's internal notes). When the template has no line for one, add it as a bullet in its features section.${rental && d.advancedPayment ? `\n- The advance payment goes on the price line, after the rent: "… /month + ${d.advancedPayment} advanced payment".` : ''}
- A commission in the template's price line is for ${rental ? 'sales: leave it off this rental unless PROPERTY DATA gives one' : 'sales: keep it'}.
- Use this property's type everywhere (a shop is never "this apartment").
- Rooms: list the bedrooms, bathrooms, balconies and terrace from PROPERTY DATA, and any room the agent's selling points name. A home may also list a living room and kitchen; never a dining room, maid's room or any other room the data doesn't name, and no rooms at all for a shop, office or plot beyond what the data names.
- Descriptive lines in the example ("Located in a Calm Neighborhood", "Spacious and decorated", "Elevator 24/24") are claims about that other property. Write one only when PROPERTY DATA supports it, and never one that contradicts the data (a "very crowded area" is not a calm neighborhood).
- If a line's data is missing or zero, leave the whole line out. Never invent facts or write "N/A".
- If the template separates master and regular bedrooms but only a total is known, list the total as bedrooms.
- Use the real figures for price and size, formatted the way the template formats them.
- Work the agent's selling points in, in the template's own voice.
- Never repeat or hint at the agent's internal notes.
- Name the location exactly as given — no country, no added city ("in Ashrafieh", never "in Ashrafieh, Lebanon").
- Never output the "--- BEGIN TEMPLATE ---" / "--- END TEMPLATE ---" lines.
- Output only the finished listing. Never explain what you did or mention the template — the text is published as it stands.`,
      maxTokens: 4000,
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
- Use ONLY the facts in PROPERTY DATA. Never state a view, sea or mountain access, parking, garden, balcony, terrace, pool, furnishing or any other feature that isn't listed there — agents publish this text as written, and a feature the property doesn't have is a false listing
- Bring out the location's appeal in general terms that are true of the area itself (neighbourhood character, convenience), never as a feature of this property
- Mention the most attractive listed features naturally
- End with a subtle call to action
- Do NOT use generic filler phrases like "don't miss this opportunity"
- Work the agent's selling points in naturally
- Never repeat or hint at the agent's internal notes
- Name the location exactly as given — no country, no added city ("in Ashrafieh", never "in Ashrafieh, Lebanon")
- Write in English
- Output the description only, no labels or preamble${d.style ? `\n- The agent asked for this draft: "${String(d.style).replace(/"/g, "'").slice(0, 300)}". Follow it, except where it would add a fact not in PROPERTY DATA — that rule wins` : ''}`,
    maxTokens: 300,
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
  }
}

/**
 * The last word on a finished English description, applied in code because
 * agents publish the text as it stands and the prompt alone did not hold:
 *
 *  • a paragraph of the model talking about its work ("The template is for a
 *    sale apartment… I'll adapt…") went out as the opening of a real listing;
 *  • rentals opened "Own this …" and carried the sale commission;
 *  • the advance payment, the second thing a renter asks, was left out.
 */
export function fitToListing(text: string, d: DescriptionInput): string {
  const paragraphs = String(text ?? '').split(/\n{2,}/)
  const remark = (p: string) =>
    /\btemplate\b/i.test(p) || /^\s*(I'?ll|I will|I have|I've|Here is|Here's|Note:|Below is)\b/i.test(p)
  // Only from the top: a remark is a preamble, never the body of a listing.
  while (paragraphs.length > 1 && remark(paragraphs[0])) paragraphs.shift()
  let out = paragraphs.join('\n\n').trim()

  if (d.transaction === 'For Rent') {
    out = out
      .replace(/^(\s*)Own this\b/gim, '$1Rent this')
      .replace(/\b(available|offered) for sale\b/gi, '$1 for rent')
      // A percentage commission is the sale commission in the agency's example.
      .replace(/[ \t]*\+[ \t]*\d+(?:\.\d+)?[ \t]*%[ \t]*commission\b/gi, '')

    const adv = String(d.advancedPayment ?? '').trim()
    if (adv && !/advance/i.test(out)) {
      // "Price: …" / "Rent: …" — the colon matters: "Rent this flat" is not it.
      const priceLine = /^([ \t]*(?:price|rent|rental price)[ \t]*:[^\n]*)$/im
      out = priceLine.test(out)
        ? out.replace(priceLine, `$1 + ${adv} advanced payment`)
        : `${out}\n\nAdvanced payment: ${adv}`
    }
  } else if (d.transaction === 'For Sale') {
    out = out.replace(/^(\s*)Rent this\b/gim, '$1Own this').replace(/\b(available|offered) for rent\b/gi, '$1 for sale')
  }
  return out
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
