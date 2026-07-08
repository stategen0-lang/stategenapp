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

    const { data, error } = await supabase
      .from('client_requests')
      .insert({
        company_id: COMPANY_ID,
        Agent_id: body.agentId ?? null,
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
