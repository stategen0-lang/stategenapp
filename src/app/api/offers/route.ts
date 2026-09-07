import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { fetchPropertyNegotiations, webLogOffer, webResolveOffer, type OfferActor } from '@/lib/offers-server'
import type { Session } from '@/lib/permissions'

const actorOf = (s: Session): OfferActor => ({ companyId: s.companyId, agentCode: s.agentCode, isManager: isManager(s.role) })

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

// Log an offer round.  POST { propertyId, clientId, amount, side, note? }
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({})) as { propertyId?: number; clientId?: number; amount?: number; side?: string; note?: string }
  const propertyId = Number(b.propertyId), clientId = Number(b.clientId), amount = Number(b.amount)
  const side = b.side === 'owner' ? 'owner' : 'buyer'
  if (!Number.isFinite(propertyId) || !Number.isFinite(clientId) || !(amount > 0)) {
    return NextResponse.json({ error: 'propertyId, clientId and a positive amount are required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const res = await webLogOffer(admin, actorOf(session), { propertyId, clientId, amount, side, note: b.note ?? null })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// Accept / reject the current offer.  PATCH { dealId, decision: 'accept'|'reject' }
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({})) as { dealId?: string; decision?: string }
  if (!b.dealId || (b.decision !== 'accept' && b.decision !== 'reject')) {
    return NextResponse.json({ error: 'dealId and a valid decision are required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const res = await webResolveOffer(admin, actorOf(session), b.dealId, b.decision)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
