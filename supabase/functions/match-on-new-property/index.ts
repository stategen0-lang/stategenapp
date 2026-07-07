import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildPropertyText, generateEmbedding } from '../_shared/embedding.ts'
import { computeScore } from '../_shared/scoring.ts'

const WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? ''
const TWILIO_SID    = Deno.env.get('TWILIO_ACCOUNT_SID')  ?? ''
const TWILIO_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')    ?? ''

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
    const { record } = await req.json()  // Supabase webhook payload
    const property = record

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Generate and store embedding
    const text = buildPropertyText({
      type:      property.type ?? '',
      location:  property.location ?? property.district ?? '',
      price:     property.price ?? 0,
      bedrooms:  property.bedrooms ?? property.Bedrooms ?? 0,
      area:      property.size ?? 0,
      amenities: JSON.parse(property.Amenities ?? '[]'),
    })
    const embedding = await generateEmbedding(text)
    await supabase.from('Properties').update({ embedding }).eq('id', property.id)

    // 2. Vector pre-filter — top 25 active clients by similarity
    const { data: candidates } = await supabase.rpc('match_clients', {
      query_embedding: embedding,
      company:         property.company_id,
      match_count:     25,
    })

    if (!candidates?.length) return new Response('ok', { status: 200 })

    // 3. Score each candidate and build inserts
    const amenities: string[] = JSON.parse(property.Amenities ?? '[]')
    const matchInserts = []

    for (const client of candidates) {
      const wishlist: string[] = []
      if (client.garden)  wishlist.push('garden')
      if (client.balcony) wishlist.push('balcony')

      const breakdown = computeScore(
        {
          price:     property.Price ?? property.price ?? 0,
          location:  `${property.district ?? ''} ${property.city ?? ''}`.trim(),
          type:      property.type ?? '',
          bedrooms:  property.Bedrooms ?? property.bedrooms ?? 0,
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
        company_id:     property.company_id,
        property_id:    property.id,
        client_id:      client.id,
        score:          breakdown.total,
        budget_score:   breakdown.budgetScore,
        location_score: breakdown.locationScore,
        type_score:     breakdown.typeScore,
        bedroom_score:  breakdown.bedroomScore,
        amenity_score:  breakdown.amenityScore,
        status:         'new',
      })

      // 4. WhatsApp notification for strong matches
      if (breakdown.total >= 75 && client.agent_phone) {
        const msg = [
          `🏠 New strong match found!`,
          `Client: ${client['Client Name']}`,
          `Property: ${property.type} in ${property.Location} — $${(property.Price ?? 0).toLocaleString()}`,
          `Match score: ${Math.round(breakdown.total)}%`,
          `Reply '1' for client details, '2' for property details.`,
        ].join('\n')
        await sendWhatsApp(client.agent_phone, msg)
      }
    }

    // 5. Upsert matches (ON CONFLICT update score)
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
    console.error('[match-on-new-property]', err)
    return new Response(String(err), { status: 500 })
  }
})
