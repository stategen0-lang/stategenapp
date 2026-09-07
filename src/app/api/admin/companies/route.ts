import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin-guard'
import { planFor } from '@/lib/stripe-plans'

export async function GET() {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('Companies')
      .select('id, Name, domain, Plan, "is active", access_status, access_until, created_at')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ companies: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const { id, active, access_until } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = createAdminClient()
    const update: Record<string, unknown> = {
      'is active': active,
      access_status: active ? 'active' : 'pending',
    }
    if (access_until !== undefined) update.access_until = access_until
    const { error } = await supabase.from('Companies').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Operator creates a company + its manager account directly (admin-controlled
// onboarding). Optionally activates it immediately for `accessDays`.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const body = await req.json()
    const companyName = String(body.companyName ?? '').trim()
    const domain = String(body.domain ?? '').toLowerCase().trim()
    const email = String(body.email ?? '').toLowerCase().trim()
    const planId = String(body.planId ?? '')
    const password = String(body.password ?? '')
    const accessDays = Number(body.accessDays)   // 0/NaN → create pending

    if (!companyName || !domain || !email || !password) return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    // The domain must look like a website (contain a dot): agent logins are the
    // synthetic email <code>@<domain>, which is only valid with a TLD. The
    // subdomain still uses just the first label (myagency.com → myagency.stategen.app).
    if (!domain.includes('.')) return NextResponse.json({ error: 'Domain must look like a website, e.g. myagency.com (needed for agent logins).' }, { status: 400 })
    if (!planFor(planId)) return NextResponse.json({ error: 'Pick a plan.' }, { status: 400 })
    if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })

    const supabase = createAdminClient()

    const { data: existing } = await supabase.from('Companies').select('id').eq('domain', domain).maybeSingle()
    if (existing) return NextResponse.json({ error: 'A company already exists for that domain.' }, { status: 409 })

    const { data: created, error: authErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: `${companyName} Manager` },
    })
    if (authErr || !created?.user) {
      const already = /already|registered|exists/i.test(authErr?.message ?? '')
      return NextResponse.json({ error: already ? 'An account already exists for this email.' : (authErr?.message ?? 'Could not create the account.') }, { status: already ? 409 : 500 })
    }

    const activate = Number.isFinite(accessDays) && accessDays > 0
    const until = activate ? new Date(Date.now() + accessDays * 86400_000).toISOString().slice(0, 10) : null
    const { data: company, error: companyErr } = await supabase
      .from('Companies')
      .insert({
        Name: companyName, domain, Plan: planId, 'is active': true,
        access_status: activate ? 'active' : 'pending',
        access_until: until,
      })
      .select('id, Name, domain, Plan, "is active", access_status, access_until, created_at')
      .single()
    if (companyErr) {
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: companyErr.message }, { status: 500 })
    }

    const { error: profileErr } = await supabase.from('Profiles').insert({
      id: created.user.id, company_id: company.id, Full_name: `${companyName} Manager`, role: 'owner', approved: true,
    })
    if (profileErr) {
      await supabase.from('Companies').delete().eq('id', company.id)
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: profileErr.message }, { status: 500 })
    }

    return NextResponse.json({ company })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
