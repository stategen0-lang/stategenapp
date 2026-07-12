import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const COMPANY_ID = Number(process.env.DEMO_COMPANY_ID ?? 1)

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('client_requests')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ clients: data ?? [] })
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

    // Build a partial update from whatever fields were sent. A status-only
    // payload ({ id, status }) updates just the status; a full edit updates
    // the client details too.
    const update: Record<string, unknown> = {}
    if (body.status !== undefined) update.status = body.status
    if (body.name !== undefined) update['Client Name'] = body.name
    if (body.phone !== undefined) update['client phone'] = body.phone
    if (body.req?.location !== undefined) update['prefered-location'] = body.req.location
    if (body.req?.priceMin !== undefined) update.budget_min = body.req.priceMin
    if (body.budget !== undefined || body.req?.priceMax !== undefined) {
      update.budget_max = body.budget ?? body.req?.priceMax ?? 0
    }
    if (body.req?.beds !== undefined) update.bedrooms = body.req.beds
    if (body.req?.transaction !== undefined) update.payment_terms = body.req.transaction
    if (body.name !== undefined || body.email !== undefined || body.type !== undefined || body.req !== undefined) {
      update.notes = JSON.stringify({ email: body.email, type: body.type, agentId: body.agentId, req: body.req })
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('client_requests')
      .update(update)
      .eq('id', id)
      .eq('company_id', COMPANY_ID)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, client: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const supabase = await createClient()

    // Pack extra UI fields into notes JSON
    const extras = {
      email: body.email,
      type: body.type,
      agentId: body.agentId,
      req: body.req,
    }

    // Agent_id is a uuid column; the UI's agentId is a mock code like "a1",
    // so only store it when it's an actual uuid (otherwise it lives in notes).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const agentUuid = typeof body.agentId === 'string' && UUID_RE.test(body.agentId) ? body.agentId : null

    const { data, error } = await supabase
      .from('client_requests')
      .insert({
        company_id: COMPANY_ID,
        Agent_id: agentUuid,
        'Client Name': body.name,
        'client phone': body.phone ?? null,
        budget_min: body.req?.priceMin ?? 0,
        budget_max: body.budget ?? body.req?.priceMax ?? 0,
        'prefered-location': body.req?.location ?? null,
        bedrooms: body.req?.beds ?? null,
        payment_terms: body.req?.transaction ?? null,
        notes: JSON.stringify(extras),
        status: body.status ?? 'Searching',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ client: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
