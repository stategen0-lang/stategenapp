import { NextRequest, NextResponse } from 'next/server'
import { chat } from '@/lib/xai'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, transaction, price, rent, district, city, size, beds, baths, garden, balcony, view, advancedPayment, notes, template } = body

    const priceStr = transaction === 'For Rent'
      ? `USD ${Number(rent).toLocaleString()}/month`
      : `USD ${Number(price).toLocaleString()}`

    const features = [
      size   ? `${size} m²` : null,
      beds   ? `${beds} bedroom${beds > 1 ? 's' : ''}` : null,
      baths  ? `${baths} bathroom${baths > 1 ? 's' : ''}` : null,
      garden  ? 'private garden' : null,
      balcony ? 'balcony' : null,
      view   ? `${view} view` : null,
      advancedPayment ? `advanced payment: ${advancedPayment}` : null,
    ].filter(Boolean).join(', ')

    const systemPrompt = template
      ? `You are a real estate copywriter. You MUST strictly follow this writing style for every description you generate:\n\n${template}`
      : `You are a professional real estate copywriter specializing in Lebanese property listings.`

    const prompt = `Write a real estate listing description for a Lebanese property with the following details:
- Type: ${type}
- Transaction: ${transaction}
- Price: ${priceStr}
- Location: ${district}, ${city}, Lebanon
- Features: ${features || 'no specific features listed'}
${notes ? `- Agent notes (use as context): ${notes}` : ''}

Rules:
- 2–3 sentences only
- Highlight location appeal using Lebanese context (Beirut lifestyle, mountain views, coastal access, etc.)
- Mention the most attractive features naturally
- End with a subtle call to action
- Do NOT use generic filler phrases like "don't miss this opportunity"
- Write in English
- Output the description only, no labels or preamble`

    const description = await chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
      { temperature: 0.7, max_tokens: 200 },
    )

    return NextResponse.json({ description: description.trim() })
  } catch (err) {
    console.error('[ai/property-description]', err)
    return NextResponse.json({ error: 'Failed to generate description' }, { status: 500 })
  }
}
