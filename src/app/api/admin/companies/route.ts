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

// Operator onboards an agency directly (no self-signup).
export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await req.json().catch(() => ({}))
  const companyName = String(body.companyName ?? '').trim()
  const domain = String(body.domain ?? '').toLowerCase().trim()
  const email = String(body.email ?? '').toLowerCase().trim()
  const planId = String(body.planId ?? '')
  const password = String(body.password ?? '')
  const accessDays = Number(body.accessDays ?? 0)   // >0 = activate now for that many days

  if (!companyName || !domain || !email || !password) return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  if (!planFor(planId)) return NextResponse.json({ error: 'Pick a plan.' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin.from('Companies').select('id').eq('domain', domain).maybeSingle()
  if (existing) return NextResponse.json({ error: 'A company with that domain already exists.' }, { status: 409 })

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: `${companyName} Manager` },
  })
  if (authErr || !created?.user) {
    const already = /already|registered|exists/i.test(authErr?.message ?? '')
    return NextResponse.json({ error: already ? 'An account already exists for that email.' : (authErr?.message ?? 'Could not create the account.') }, { status: already ? 409 : 500 })
  }

  const { data: company, error: companyErr } = await admin.from('Companies').insert({
    Name: companyName,
    domain,
    Plan: planId,
    'is active': true,
    access_status: accessDays > 0 ? 'active' : 'pending',
    access_until: accessDays > 0 ? new Date(Date.now() + accessDays * 86_400_000).toISOString() : null,
  }).select().single()
  if (companyErr) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    return NextResponse.json({ error: companyErr.message }, { status: 500 })
  }

  const { error: profileErr } = await admin.from('Profiles').insert({
    id: created.user.id, company_id: company.id, Full_name: `${companyName} Manager`, role: 'owner', approved: true,
  })
  if (profileErr) {
    await admin.from('Companies').delete().eq('id', company.id)
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, companyId: company.id })
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
