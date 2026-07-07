import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildPropertyText, buildClientText, generateEmbedding } from '../_shared/embedding.ts'
import { computeScore } from '../_shared/scoring.ts'

serve(async (req) => {
  try {
    const { property_id, client_id } = await req.json()
    if (!property_id && !client_id) {
      return new Response('property_id or client_id required', { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Delete existing matches for this entity
    if (property_id) {
      await supabase.from('matches').delete().eq('property_id', property_id)
    } else {
      await supabase.from('matches').delete().eq('client_id', client_id)
    }

    // Re-run matching by calling the appropriate function
    const functionName = property_id ? 'match-on-new-property' : 'match-on-new-client'

    let record
    if (property_id) {
      const { data } = await supabase.from('Properties').select('*').eq('id', property_id).single()
      record = data
    } else {
      const { data } = await supabase.from('client_requests').select('*').eq('id', client_id).single()
      record = data
    }

    if (!record) return new Response('record not found', { status: 404 })

    // Inline re-match (avoids an HTTP self-call)
    const isProperty = !!property_id
    const wishlist: string[] = []
    if (!isProperty) {
      if (record.garden)  wishlist.push('garden')
      if (record.balcony) wishlist.push('balcony')
    }

    const text = isProperty
      ? buildPropertyText({
          type: record.type ?? '', location: `${record.district ?? ''} ${record.city ?? ''}`,
          price: record.Price ?? 0, bedrooms: record.Bedrooms ?? 0,
          area: record.size ?? 0, amenities: JSON.parse(record.Amenities ?? '[]'),
        })
      : buildClientText({
          preferred_type: record.property_type ?? '', preferred_location: record['prefered-location'] ?? '',
          budget_max: record.budget_max ?? 0, bedrooms: record.bedrooms ?? 0, amenity_wishlist: wishlist,
        })

    const embedding = await generateEmbedding(text)

    // Update embedding
    const table = isProperty ? 'Properties' : 'client_requests'
    const idField = isProperty ? 'id' : 'id'
    await supabase.from(table).update({ embedding }).eq(idField, record.id)

    // Vector pre-filter
    const rpcName = isProperty ? 'match_clients' : 'match_properties'
    const { data: candidates } = await supabase.rpc(rpcName, {
      query_embedding: embedding,
      company: record.company_id,
      match_count: 25,
    })

    if (!candidates?.length) return new Response(JSON.stringify({ matched: 0 }), { status: 200 })

    const matchInserts = []
    for (const candidate of candidates) {
      const propRecord    = isProperty ? record   : candidate
      const clientRecord  = isProperty ? candidate : record
      const amenities: string[] = JSON.parse(propRecord.Amenities ?? '[]')
      const cWishlist: string[] = isProperty
        ? [...(clientRecord.garden ? ['garden'] : []), ...(clientRecord.balcony ? ['balcony'] : [])]
        : wishlist

      const breakdown = computeScore(
        { price: propRecord.Price ?? 0, location: `${propRecord.Neighborhood ?? ''} ${propRecord.Location ?? ''}`,
          type: propRecord.type ?? '', bedrooms: propRecord.Bedrooms ?? 0, amenities },
        { budget_max: clientRecord.budget_max ?? 0, preferred_location: clientRecord['prefered-location'] ?? '',
          preferred_type: clientRecord.property_type ?? '', bedrooms: clientRecord.bedrooms ?? 0,
          amenity_wishlist: cWishlist },
      )

      if (breakdown.total < 50) continue
      matchInserts.push({
        company_id:     record.company_id,
        property_id:    isProperty ? record.id : candidate.id,
        client_id:      isProperty ? candidate.id : record.id,
        score:          breakdown.total,
        budget_score:   breakdown.budgetScore,
        location_score: breakdown.locationScore,
        type_score:     breakdown.typeScore,
        bedroom_score:  breakdown.bedroomScore,
        amenity_score:  breakdown.amenityScore,
        status:         'new',
      })
    }

    if (matchInserts.length > 0) {
      await supabase.from('matches').upsert(matchInserts, { onConflict: 'property_id,client_id' })
    }

    return new Response(JSON.stringify({ matched: matchInserts.length }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[rematch]', err)
    return new Response(String(err), { status: 500 })
  }
})
