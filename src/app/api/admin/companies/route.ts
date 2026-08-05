import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { planFor } from '@/lib/stripe-plans'

// Platform-admin: list and manage every company (manual billing).
//
//   GET   — all companies with plan, access status/until, and seat usage
//   PATCH — { id, plan?, access_status?, access_until? }
//
// StateGen operators only (session.isPlatformAdmin).

async function requireAdmin() {
  const session = await getSession()
  if (!session) return { error: 'Unauthorized', status: 401 as const }
  if (!session.isPlatformAdmin) return { error: 'Forbidden', status: 403 as const }
  return { session }
}

export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  const [{ data: companies }, { data: profiles }, { data: invoices }] = await Promise.all([
    admin.from('Companies').select('id, Name, domain, Plan, access_status, access_until, created_at').order('created_at', { ascending: false }),
    admin.from('Profiles').select('company_id, role, approved'),
    admin.from('invoices').select('company_id, status'),
  ])

  const seatsByCompany = new Map<number, number>()
  for (const p of profiles ?? []) {
    if (p.role === 'agent' && p.approved === true) {
      seatsByCompany.set(p.company_id as number, (seatsByCompany.get(p.company_id as number) ?? 0) + 1)
    }
  }
  const unpaidByCompany = new Map<number, number>()
  for (const i of invoices ?? []) {
    if (i.status === 'unpaid') unpaidByCompany.set(i.company_id as number, (unpaidByCompany.get(i.company_id as number) ?? 0) + 1)
  }

  const rows = (companies ?? []).map(c => ({
    id: c.id,
    name: c.Name,
    domain: c.domain,
    plan: c.Plan,
    agentLimit: planFor(c.Plan as string)?.agentLimit ?? null,
    accessStatus: c.access_status,
    accessUntil: c.access_until,
    createdAt: c.created_at,
    seats: seatsByCompany.get(c.id as number) ?? 0,
    unpaidInvoices: unpaidByCompany.get(c.id as number) ?? 0,
  }))

  return NextResponse.json({ companies: rows })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if (body.plan !== undefined) {
    if (!planFor(String(body.plan))) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    update.Plan = body.plan
  }
  if (body.access_status !== undefined) {
    if (!['pending', 'active', 'expired', 'suspended'].includes(body.access_status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    update.access_status = body.access_status
  }
  if (body.access_until !== undefined) update.access_until = body.access_until   // ISO string or null
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin.from('Companies').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
