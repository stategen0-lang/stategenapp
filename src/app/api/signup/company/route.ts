import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { planFor } from '@/lib/stripe-plans'
import { generateAgentCode } from '@/lib/agent-code'

// Company signup — manual billing (no Stripe).
//
// Creates the manager account (email_confirm:true so they can sign in) and the
// company in 'pending' state: they can log in and reach the /renew screen, but
// get no app access until a StateGen operator activates them in /admin after an
// offline payment.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const companyName = String(body.companyName ?? '').trim()
    const domain = String(body.domain ?? '').toLowerCase().trim()
    const email = String(body.email ?? '').toLowerCase().trim()
    const planId = String(body.planId ?? '')
    const password = String(body.password ?? '')

    if (!companyName || !domain || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }
    if (!planFor(planId)) {
      return NextResponse.json({ error: 'Pick a plan.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Domain is the agency's identity (agents join under it) — must be unique.
    const { data: existing } = await admin.from('Companies').select('id').eq('domain', domain).maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'An account already exists for that domain. Try signing in.' }, { status: 409 })
    }

    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `${companyName} Manager` },
    })
    if (authErr || !created?.user) {
      const already = /already|registered|exists/i.test(authErr?.message ?? '')
      return NextResponse.json(
        { error: already ? 'An account already exists for this email — please sign in.' : (authErr?.message ?? 'Could not create the account.') },
        { status: already ? 409 : 500 },
      )
    }

    const { data: company, error: companyErr } = await admin
      .from('Companies')
      .insert({
        Name: companyName,
        domain,
        Plan: planId,
        'is active': true,
        access_status: 'pending',   // no access until an operator activates
      })
      .select()
      .single()
    if (companyErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: companyErr.message }, { status: 500 })
    }

    // Managers work deals themselves, so give the owner an agent_code too — it's
    // what lets them OWN listings/clients and receive referral commission.
    const { error: profileErr } = await admin.from('Profiles').insert({
      id: created.user.id,
      company_id: company.id,
      Full_name: `${companyName} Manager`,
      role: 'owner',
      agent_code: generateAgentCode(companyName || 'Manager'),
      approved: true,
    })
    if (profileErr) {
      await admin.from('Companies').delete().eq('id', company.id)
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: profileErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[signup/company]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signup failed.' }, { status: 500 })
  }
}
