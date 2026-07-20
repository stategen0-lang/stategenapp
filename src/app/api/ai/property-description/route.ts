import { NextRequest, NextResponse } from 'next/server'
import { chat } from '@/lib/xai'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      title, type, transaction, price, rent, district, city, size, beds, baths,
      garden, balcony, view, parkings, buildingAge, needsRenovation,
      advancedPayment, notes, template,
    } = body

    const priceStr = transaction === 'For Rent'
      ? `USD ${Number(rent).toLocaleString()}/month`
      : `USD ${Number(price).toLocaleString()}`

    // One data block, used by both modes. Only include what we actually know so
    // the model never has to invent a value for a placeholder.
    const facts = [
      title ? `Title: ${title}` : null,
      `Property type: ${type}`,
      `Transaction: ${transaction} (${transaction === 'For Rent' ? 'rental' : 'sale'})`,
      `Price: ${priceStr}`,
      `Location: ${district}, ${city}, Lebanon`,
      size ? `Size: ${size} m²` : null,
      beds ? `Bedrooms: ${beds}` : null,
      baths ? `Bathrooms: ${baths}` : null,
      parkings ? `Parking spaces: ${parkings}` : null,
      view ? `View: ${view}` : null,
      garden ? 'Has a private garden' : null,
      balcony ? 'Has a balcony' : null,
      buildingAge ? `Building age: ${buildingAge} years` : null,
      needsRenovation ? 'Needs renovation' : null,
      advancedPayment ? `Advanced payment: ${advancedPayment}` : null,
      notes ? `Agent notes (context only): ${notes}` : null,
    ].filter(Boolean).join('\n- ')

    let systemPrompt: string
    let prompt: string
    let maxTokens: number

    if (template && String(template).trim()) {
      // ── Template mode ──────────────────────────────────────────────────────
      // The template dictates structure AND length. Critically, we do NOT add a
      // sentence limit here: the old prompt asked for "2-3 sentences only" even
      // when a multi-section template was supplied, so the template was ignored.
      systemPrompt =
        'You fill in real estate listing templates. You reproduce the given template exactly — same sections, ' +
        'headings, line breaks, bullet points and ordering — replacing only the placeholders with real property data. ' +
        'You never add commentary, and you never leave placeholder brackets in the output.'

      prompt = `TEMPLATE (reproduce this structure exactly):
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
- Output only the finished description — no preamble, no explanation, no markdown code fences.`

      // Grok is a reasoning model: it spends a large, variable number of tokens
      // thinking before it writes (observed 1000-1300 on this prompt), and that
      // comes out of the same budget. The old 200-token cap left nothing for the
      // answer, and even 1200 intermittently returned an empty string. Keep this
      // generous — structured templates also run long by nature.
      maxTokens = 4000
    } else {
      // ── Free-form mode (no template selected) — short marketing copy ───────
      systemPrompt = 'You are a professional real estate copywriter specializing in Lebanese property listings.'

      prompt = `Write a real estate listing description for a Lebanese property.

PROPERTY DATA:
- ${facts}

Rules:
- 2-3 sentences only
- Highlight location appeal using Lebanese context (Beirut lifestyle, mountain views, coastal access, etc.)
- Mention the most attractive features naturally
- End with a subtle call to action
- Do NOT use generic filler phrases like "don't miss this opportunity"
- Write in English
- Output the description only, no labels or preamble`

      maxTokens = 300
    }

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: prompt },
    ]

    // Strip any stray code fences the model might wrap the answer in.
    const tidy = (s: string) =>
      s.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()

    let clean = tidy(await chat(messages, { temperature: template ? 0.4 : 0.7, max_tokens: maxTokens }))

    // The model occasionally spends its whole budget reasoning and returns an
    // empty string. Retry once rather than handing the UI a blank description.
    if (!clean) {
      clean = tidy(await chat(messages, { temperature: template ? 0.4 : 0.7, max_tokens: maxTokens }))
    }
    if (!clean) {
      return NextResponse.json(
        { error: 'The model returned an empty description. Please try again.' },
        { status: 502 },
      )
    }

    return NextResponse.json({ description: clean })
  } catch (err) {
    console.error('[ai/property-description]', err)
    const message = err instanceof Error ? err.message : 'Failed to generate description'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
