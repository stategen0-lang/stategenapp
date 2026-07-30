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
  view?: string
  parkings?: number
  buildingAge?: number
  needsRenovation?: boolean
  advancedPayment?: unknown
  notes?: string
}

export interface Prompts {
  systemPrompt: string
  prompt: string
  maxTokens: number
  temperature: number
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
    `Location: ${d.district}, ${d.city}, Lebanon`,
    d.size ? `Size: ${d.size} m²` : null,
    d.beds ? `Bedrooms: ${d.beds}` : null,
    d.baths ? `Bathrooms: ${d.baths}` : null,
    d.parkings ? `Parking spaces: ${d.parkings}` : null,
    d.view ? `View: ${d.view}` : null,
    d.garden ? 'Has a private garden' : null,
    d.balcony ? 'Has a balcony' : null,
    d.buildingAge ? `Building age: ${d.buildingAge} years` : null,
    d.needsRenovation ? 'Needs renovation' : null,
    d.advancedPayment ? `Advanced payment: ${d.advancedPayment}` : null,
    d.notes ? `Agent notes (context only): ${d.notes}` : null,
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
- Write in English
- Output the description only, no labels or preamble`,
    maxTokens: 300,
    temperature: 0.7,
  }
}
