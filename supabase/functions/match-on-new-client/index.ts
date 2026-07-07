import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildClientText, generateEmbedding } from '../_shared/embedding.ts'
import { computeScore } from '../_shared/scoring.ts'

const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')  ?? ''
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')    ?? ''
const WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? ''

async function sendWhatsApp(to: string, body: string) {
  if (!TWILIO_SID || !to) return
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: `whatsapp:${WHATSAPP_FROM}`, To: `whatsapp:${to}`, Body: body }),
  })
}

serve(async (req) => {
  try {
    const { record } = await req.json()
    const client = record

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Build client wishlist from boolean fields
    const wishlist: string[] = []
    if (client.garden)  wishlist.push('garden')
    if (client.balcony) wishlist.push('balcony')

    // 1. Generate and store embedding
    const text = buildClientText({
      preferred_type:     client.property_type ?? '',
      preferred_location: client['prefered-location'] ?? '',
      budget_max:         client.budget_max ?? 0,
      bedrooms:           client.bedrooms ?? 0,
      amenity_wishlist:   wishlist,
    })
    const embedding = await generateEmbedding(text)
    await supabase.from('client_requests').update({ embedding }).eq('id', client.id)

    // 2. Vector pre-filter — top 25 active properties by similarity
    const { data: candidates } = await supabase.rpc('match_properties', {
      query_embedding: embedding,
      company:         client.company_id,
      match_count:     25,
    })

    if (!candidates?.length) return new Response('ok', { status: 200 })

    // 3. Score and insert
    const matchInserts = []

    for (const prop of candidates) {
      const amenities: string[] = JSON.parse(prop.Amenities ?? '[]')

      const breakdown = computeScore(
        {
          price:     prop.Price ?? 0,
          location:  `${prop.Neighborhood ?? ''} ${prop.Location ?? ''}`.trim(),
          type:      prop.type ?? '',
          bedrooms:  prop.Bedrooms ?? 0,
          amenities,
        },
        {
          budget_max:         client.budget_max ?? 0,
          preferred_location: client['prefered-location'] ?? '',
          preferred_type:     client.property_type ?? '',
          bedrooms:           client.bedrooms ?? 0,
          amenity_wishlist:   wishlist,
        },
      )

      if (breakdown.total < 50) continue

      matchInserts.push({
        company_id:     client.company_id,
        property_id:    prop.id,
        client_id:      client.id,
        score:          breakdown.total,
        budget_score:   breakdown.budgetScore,
        location_score: breakdown.locationScore,
        type_score:     breakdown.typeScore,
        bedroom_score:  breakdown.bedroomScore,
        amenity_score:  breakdown.amenityScore,
        status:         'new',
      })

      // 4. Notify agent on strong match
      if (breakdown.total >= 75 && client.agent_phone) {
        const msg = [
          `🏠 New strong match found!`,
          `Client: ${client['Client Name']}`,
          `Property: ${prop.type} in ${prop.Location} — $${(prop.Price ?? 0).toLocaleString()}`,
          `Match score: ${Math.round(breakdown.total)}%`,
          `Reply '1' for client details, '2' for property details.`,
        ].join('\n')
        await sendWhatsApp(client.agent_phone, msg)
      }
    }

    if (matchInserts.length > 0) {
      await supabase.from('matches').upsert(matchInserts, {
        onConflict: 'property_id,client_id',
        ignoreDuplicates: false,
      })
    }

    return new Response(JSON.stringify({ matched: matchInserts.length }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[match-on-new-client]', err)
    return new Response(String(err), { status: 500 })
  }
})
