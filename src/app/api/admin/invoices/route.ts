import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-guard'
import { planFor } from '@/lib/stripe-plans'
import { DEFAULT_PERIOD_DAYS } from '@/lib/billing'

// Platform-admin: invoices for manual billing.
//
//   GET   ?companyId — that company's invoices, newest first
//   POST  { companyId, plan?, amount?, period_start?, period_end?, method?, note? }
//           creates an unpaid invoice (amount/period default from the plan)
//   PATCH { id, status:'paid'|'void', method? }
//           marking paid stamps paid_at AND activates the company through the
//           invoice's period_end — this is how access is granted/renewed.

const iso = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const companyId = Number(req.nextUrl.searchParams.get('companyId'))
  const admin = createAdminClient()
  let q = admin.from('invoices').select('*').order('created_at', { ascending: false })
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q
  return NextResponse.json({ invoices: data ?? [] })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await req.json().catch(() => ({}))
  const companyId = Number(body.companyId)
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: company } = await admin.from('Companies').select('Plan').eq('id', companyId).maybeSingle()
  const plan = String(body.plan ?? company?.Plan ?? 'team')
  const planDef = planFor(plan)

  // Sensible defaults: this plan's price, a one-month period starting today.
  const today = new Date()
  const periodStart = body.period_start ? new Date(body.period_start) : today
  const periodEnd = body.period_end ? new Date(body.period_end) : new Date(today.getTime() + DEFAULT_PERIOD_DAYS * 86_400_000)
  const amount = body.amount != null ? Number(body.amount) : (planDef?.price ?? 0)

  // Human number: INV-YEAR-#### based on the count so far.
  const { count } = await admin.from('invoices').select('id', { count: 'exact', head: true })
  const number = `INV-${today.getFullYear()}-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data, error } = await admin.from('invoices').insert({
    company_id: companyId,
    number,
    plan,
    amount,
    currency: 'USD',
    period_start: iso(periodStart),
    period_end: iso(periodEnd),
    status: 'unpaid',
    method: body.method ?? null,
    note: body.note ?? null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoice: data })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '')
  const status = String(body.status ?? '')
  if (!id || !['paid', 'void', 'unpaid'].includes(status)) {
    return NextResponse.json({ error: 'id and valid status required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('*').eq('id', id).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const update: Record<string, unknown> = { status }
  if (status === 'paid') {
    update.paid_at = new Date().toISOString()
    if (body.method) update.method = body.method
  } else {
    update.paid_at = null
  }
  const { error } = await admin.from('invoices').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Paying an invoice activates the company through the invoice's period end.
  if (status === 'paid' && inv.period_end) {
    await admin.from('Companies').update({
      access_status: 'active',
      access_until: new Date(inv.period_end as string).toISOString(),
      Plan: inv.plan ?? undefined,
    }).eq('id', inv.company_id)
  }

  return NextResponse.json({ ok: true })
}
