import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { fetchPropertyNegotiations } from '@/lib/offers-server'

// Negotiations on a listing. Manager sees the whole agency's; an agent sees
// only deals they own.  GET /api/offers?propertyId=23
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const propertyId = Number(req.nextUrl.searchParams.get('propertyId'))
  if (!Number.isFinite(propertyId) || propertyId <= 0) {
    return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const negotiations = await fetchPropertyNegotiations(admin, {
    companyId: session.companyId,
    propertyId,
    agentCode: isManager(session.role) ? null : session.agentCode,
  })
  return NextResponse.json({ negotiations })
}
