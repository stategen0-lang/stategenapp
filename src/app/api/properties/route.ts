import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { canEditProperty, isManager } from '@/lib/permissions'
import { createListingAlerts } from '@/lib/alerts-server'

// The listing agent's code lives in the property's Amenities JSON.
function propertyAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.Amenities as string) || '{}').agentId as string) ?? null } catch { return null }
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('Properties')
      .select('*')
      .eq('company_id', session.companyId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ properties: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const supabase = await createClient()

    // An agent's new listing is always filed under their own code.
    if (!isManager(session.role) && session.agentCode) body.agentId = session.agentCode

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
        company_id: session.companyId,
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

    // Raise match alerts for clients this new listing fits. Non-fatal: the
    // listing is already saved, so a failure here must not fail the request.
    let alerts = 0
    try {
      alerts = await createListingAlerts(createAdminClient(), session.companyId, data as Record<string, unknown>)
    } catch { /* already logged inside */ }

    return NextResponse.json({ property: data, alerts })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = await createClient()

    // Everyone can view the shared inventory; only the lister (or a manager)
    // can change a listing.
    const { data: existing } = await supabase
      .from('Properties').select('id,Amenities').eq('id', id).eq('company_id', session.companyId).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canEditProperty(session, propertyAgent(existing))) {
      return NextResponse.json({ error: 'Forbidden — this listing belongs to another agent' }, { status: 403 })
    }

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
      .eq('company_id', session.companyId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ property: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
