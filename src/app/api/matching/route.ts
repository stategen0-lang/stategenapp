import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ClientRequest, Property, MatchResult } from '@/types/database'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const MATCH_THRESHOLD = 60

export async function POST(req: NextRequest) {
  const { clientId } = await req.json()

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: clientData } = await admin
    .from('client_requests')
    .select('*')
    .eq('id', clientId)
    .single()

  if (!clientData) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  const client = clientData as ClientRequest

  const { data: propertiesData } = await admin
    .from('Properties')
    .select('*')
    .eq('company_id', client.company_id)
    .eq('Status', 'available')

  const properties = (propertiesData ?? []) as Property[]

  if (properties.length === 0) {
    return NextResponse.json({ matches: [], message: 'No available properties to match' })
  }

  const clientProfile = `
Client Name: ${client['Client Name']}
Budget: ${client.budget_min ?? 0} – ${client.budget_max ?? 'unlimited'}
Preferred Location: ${client['prefered-location'] ?? 'any'}
Bedrooms needed: ${client.bedrooms ?? 'any'}
Payment terms: ${client.payment_terms ?? 'any'}
Notes: ${client.notes ?? 'none'}
`.trim()

  const propertyList = properties.map((p) => {
    let amenities: string[] = []
    try { amenities = JSON.parse(p.Amenities ?? '[]') } catch { amenities = [] }
    return `
Property ID: ${p.id}
Title: ${p.Title}
Location: ${p.Location ?? '—'}, Neighborhood: ${p.Neighborhood ?? '—'}
Price: ${p.Price ?? '—'} ${p.Currency ?? ''}
Bedrooms: ${p.Bedrooms ?? '—'}, Bathrooms: ${p.bathrooms ?? '—'}, Size: ${p.size ?? '—'} m²
Floor: ${p.Floor_num ?? '—'} (${p['Floor Type'] ?? '—'})
Payment terms: ${p.Payment_terms ?? '—'}
Amenities: ${amenities.join(', ') || 'none'}
`.trim()
  }).join('\n\n---\n\n')

  const prompt = `You are a real estate matching expert. Score each property for the client below.

CLIENT REQUIREMENTS:
${clientProfile}

AVAILABLE PROPERTIES:
${propertyList}

For each property return a JSON array. Each item must have:
- property_id (number)
- score (0-100, integer)
- reasons (array of 2-3 short strings explaining the match)

Rules:
- Score 80-100: excellent match (budget fits, location matches, bedrooms match)
- Score 60-79: good match (most criteria met, minor gaps)
- Score 0-59: poor match (significant criteria missed)
- If price is outside budget by more than 20%, cap score at 50
- If location doesn't match at all, cap score at 40
- Be precise — don't inflate scores

Return ONLY a valid JSON array, no other text.`

  let matches: MatchResult[] = []

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const parsed = JSON.parse(text) as Array<{ property_id: number; score: number; reasons: string[] }>

    matches = parsed
      .filter((m) => m.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .map((m) => ({ property_id: m.property_id, score: m.score, reasons: m.reasons, notified: false }))
  } catch (e) {
    console.error('Matching AI error:', e)
    return NextResponse.json({ error: 'AI matching failed' }, { status: 500 })
  }

  await admin
    .from('client_requests')
    .update({ match_results: matches })
    .eq('id', clientId)

  return NextResponse.json({ matches, total: matches.length })
}
