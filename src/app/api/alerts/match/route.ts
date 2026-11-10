import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { buildMatchDetail } from '@/lib/match-detail'

// One match, in full: the listing and the client's request. Behind an alert —
// the pair must exist as an alert this person may see, so the URL cannot be used
// to pull up any client by number.

type Row = Record<string, unknown>

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const propertyId = Number(req.nextUrl.searchParams.get('property'))
  const clientId = Number(req.nextUrl.searchParams.get('client'))
  if (!Number.isInteger(propertyId) || !Number.isInteger(clientId)) {
    return NextResponse.json({ error: 'property and client required' }, { status: 400 })
  }

  const supabase = await createClient()
  let query = supabase
    .from('listing_alerts')
    .select('*')
    .eq('company_id', session.companyId)
    .eq('property_id', propertyId)
    .eq('client_id', clientId)
    .limit(1)
  // The same scope as the alerts list: an agent only reaches their own.
  if (!isManager(session.role)) query = query.eq('agent_code', session.agentCode)

  const { data: alerts, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const alert = (alerts ?? [])[0] as Row | undefined
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: property }, { data: client }] = await Promise.all([
    supabase.from('Properties').select('*').eq('id', propertyId).eq('company_id', session.companyId).maybeSingle(),
    supabase.from('client_requests').select('*').eq('id', clientId).eq('company_id', session.companyId).maybeSingle(),
  ])
  if (!property || !client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ match: buildMatchDetail(session, property as Row, client as Row, alert) })
}
