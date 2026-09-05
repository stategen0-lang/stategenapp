import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { canEditProperty, isManager, owns, type Session } from '@/lib/permissions'
import { createListingAlerts } from '@/lib/alerts-server'

// The listing agent's code lives in the property's Amenities JSON.
function propertyAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.Amenities as string) || '{}').agentId as string) ?? null } catch { return null }
}

// Owner name/contact and the private document are confidential to the listing's
// own agent and managers. Everyone else in the company shares the inventory but
// must not receive these — so we strip them from the raw row before it leaves
// the server, not just hide them in the UI (which the network tab would expose).
function stripPrivateFields(row: Record<string, unknown>, session: Session): Record<string, unknown> {
  if (isManager(session.role) || owns(session, propertyAgent(row))) return row
  try {
    const ex = JSON.parse((row.Amenities as string) || '{}')
    delete ex.ownerName; delete ex.ownerContact; delete ex.documentPath; delete ex.documentName; delete ex.mapUrl
    return { ...row, Amenities: JSON.stringify(ex) }
  } catch { return row }
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
    const rows = (data ?? []).map(r => stripPrivateFields(r as Record<string, unknown>, session))
    return NextResponse.json({ properties: rows })
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
      terrace: body.terrace,
      amenities: Array.isArray(body.amenities) ? body.amenities : [],
      buildingFeatures: Array.isArray(body.buildingFeatures) ? body.buildingFeatures : [],
      furnishing: body.furnishing,
      view: body.view,
      mapUrl: body.mapUrl,
      video: body.video,
      rent: body.rent,
      advancedPayment: body.advancedPayment,
      agentId: body.agentId,
      notes: body.notes,
      referredBy: body.referredBy,
      aiDescription: body.aiDescription,
      parkings: body.parkings,
      buildingAge: body.buildingAge,
      floor: body.floor,
      needsRenovation: body.needsRenovation,
      ownerName: body.ownerName,
      ownerContact: body.ownerContact,
      documentPath: body.documentPath,
      documentName: body.documentName,
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

    // Raise match alerts for clients this new listing fits — deferred with
    // after() so the save returns instantly; the scan runs off the response path.
    // Non-fatal: the listing is already saved, so a failure here can't fail it.
    const companyId = session.companyId
    const saved = data as Record<string, unknown>
    after(async () => {
      try { await createListingAlerts(createAdminClient(), companyId, saved) } catch { /* already logged inside */ }
    })

    return NextResponse.json({ property: data })
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
      terrace: body.terrace,
      amenities: Array.isArray(body.amenities) ? body.amenities : [],
      buildingFeatures: Array.isArray(body.buildingFeatures) ? body.buildingFeatures : [],
      furnishing: body.furnishing,
      view: body.view,
      mapUrl: body.mapUrl,
      video: body.video,
      rent: body.rent,
      advancedPayment: body.advancedPayment,
      agentId: body.agentId,
      notes: body.notes,
      referredBy: body.referredBy,
      aiDescription: body.aiDescription,
      parkings: body.parkings,
      buildingAge: body.buildingAge,
      floor: body.floor,
      needsRenovation: body.needsRenovation,
      ownerName: body.ownerName,
      ownerContact: body.ownerContact,
      documentPath: body.documentPath,
      documentName: body.documentName,
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
