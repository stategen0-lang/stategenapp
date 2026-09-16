import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession, companyAccessBlocked } from '@/lib/session'
import { canEditProperty, isManager } from '@/lib/permissions'
import { loadProperties, propertyAgent } from '@/lib/api-loaders'
import { createListingAlerts } from '@/lib/alerts-server'
import { ensureManagerAgentCode } from '@/lib/ensure-manager-code'
import { DOC_BUCKET } from '@/lib/upload'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const supabase = await createClient()
    return NextResponse.json({ properties: await loadProperties(supabase, session) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const body = await req.json()
    const supabase = await createClient()

    // A new listing is always filed under its creator's own code — an agent's,
    // or a manager's (managers work deals too; mint their code if missing so it's
    // never stamped to a phantom demo agent).
    let ownCode = session.agentCode
    if (!ownCode && isManager(session.role)) {
      ownCode = await ensureManagerAgentCode(createAdminClient(), session.companyId, session.userId, session.fullName)
    }
    if (ownCode) body.agentId = ownCode

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
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = await createClient()

    // Everyone can view the shared inventory; only the lister (or a manager)
    // can change a listing.
    const { data: existing } = await supabase
      .from('Properties').select('id,Amenities').eq('id', id).eq('company_id', session.companyId).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Server-owned keys the edit form never sends. Rebuilding the blob from the
    // form alone would erase them (the listing would forget it was already sent
    // to marketing), so carry them over.
    let prevExtras: Record<string, unknown> = {}
    try { prevExtras = JSON.parse((existing.Amenities as string) || '{}') } catch { prevExtras = {} }
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
      marketingSentAt: prevExtras.marketingSentAt,
      marketingSentBy: prevExtras.marketingSentBy,
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

// Delete a listing. Same rule as editing: its own agent or a manager. The
// database cleans up what hangs off it (match alerts cascade; deals and calendar
// events keep their row but lose the listing link).
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await companyAccessBlocked(session)) {
    return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
  }

  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid listing id is required.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('Properties').select('id,Amenities').eq('id', id).eq('company_id', session.companyId).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 })
  if (!canEditProperty(session, propertyAgent(existing))) {
    return NextResponse.json({ error: 'Only the listing\'s agent or a manager can delete it.' }, { status: 403 })
  }

  const { error } = await admin.from('Properties').delete().eq('id', id).eq('company_id', session.companyId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The private document (e.g. an owner's deed) must not outlive the listing in
  // storage. Best-effort, after the response.
  let docPath: string | null = null
  try { docPath = (JSON.parse((existing.Amenities as string) || '{}').documentPath as string) ?? null } catch { docPath = null }
  if (docPath && docPath.startsWith(`company-${session.companyId}/`)) {
    after(async () => {
      try { await admin.storage.from(DOC_BUCKET).remove([docPath!]) } catch { /* best-effort */ }
    })
  }

  return NextResponse.json({ ok: true, id })
}
