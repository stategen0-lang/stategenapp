import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const COMPANY_ID = Number(process.env.DEMO_COMPANY_ID ?? 1)

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('Properties')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ properties: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const supabase = await createClient()

    // Pack extra UI fields that don't have dedicated DB columns into Amenities JSON
    const extras = {
      type: body.type,
      transaction: body.transaction,
      garden: body.garden,
      balcony: body.balcony,
      view: body.view,
      rent: body.rent,
      advancedPayment: body.advancedPayment,
      agentId: body.agentId,
      notes: body.notes,
      aiDescription: body.aiDescription,
      parkings: body.parkings,
      status: body.status,
    }

    const { data, error } = await supabase
      .from('Properties')
      .insert({
        company_id: COMPANY_ID,
        Title: body.title,
        Location: body.city,
        Neighborhood: body.district,
        Price: body.price || body.rent || 0,
        Currency: 'USD',
        Bedrooms: body.beds,
        bathrooms: body.baths,
        size: body.size,
        Payment_terms: body.transaction,
        Amenities: JSON.stringify(extras),
        Photos: body.photos ? JSON.stringify(body.photos) : null,
        Status: body.status ?? 'Available',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ property: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = await createClient()

    const extras = {
      type: body.type,
      transaction: body.transaction,
      garden: body.garden,
      balcony: body.balcony,
      view: body.view,
      rent: body.rent,
      advancedPayment: body.advancedPayment,
      agentId: body.agentId,
      notes: body.notes,
      aiDescription: body.aiDescription,
      parkings: body.parkings,
      buildingAge: body.buildingAge,
      needsRenovation: body.needsRenovation,
      status: body.status,
    }

    const { data, error } = await supabase
      .from('Properties')
      .update({
        Title: body.title,
        Location: body.city,
        Neighborhood: body.district,
        Price: body.price || body.rent || 0,
        Currency: 'USD',
        Bedrooms: body.beds,
        bathrooms: body.baths,
        size: body.size,
        Payment_terms: body.transaction,
        Amenities: JSON.stringify(extras),
        Photos: body.photos ? JSON.stringify(body.photos) : null,
        Status: body.status ?? 'Available',
      })
      .eq('id', id)
      .eq('company_id', COMPANY_ID)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ property: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
