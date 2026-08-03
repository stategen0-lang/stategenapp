import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { agentLimitFor } from '@/lib/stripe-plans'

// Agent signup — server-authoritative.
//
// Done on the server (not the browser) for two reasons:
//   1. The plan's agent cap is a billing limit, so it must be enforced where the
//      client can't skip it.
//   2. Agent emails are synthetic (agentcode@domain) with no real inbox, so the
//      account is created with email_confirm:true — otherwise the agent could
//      never confirm and never sign in.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const domain = String(body.domain ?? '').toLowerCase().trim()
    const agentCode = String(body.agentCode ?? '').trim()
    const fullName = String(body.fullName ?? '').trim()
    const password = String(body.password ?? '')

    if (!domain || !agentCode || !fullName || !password) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: company } = await admin
      .from('Companies')
      .select('id, Name, Plan')
      .eq('domain', domain)
      .maybeSingle()
    if (!company) {
      return NextResponse.json({ error: 'No agency found for that domain.' }, { status: 404 })
    }

    // Enforce the plan's agent cap.
    const limit = agentLimitFor(company.Plan as string)
    const { count } = await admin
      .from('Profiles')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .eq('role', 'agent')
    const used = count ?? 0
    if (limit !== null && used >= limit) {
      return NextResponse.json(
        { error: `${company.Name} has reached its plan's limit of ${limit} agents. Ask your manager to upgrade to add more seats.` },
        { status: 409 },
      )
    }

    const email = `${agentCode.toLowerCase()}@${domain}`
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (authErr || !created?.user) {
      const already = /already|registered|exists/i.test(authErr?.message ?? '')
      return NextResponse.json(
        { error: already ? 'An account with that agent ID already exists — go back and try again for a new ID.' : (authErr?.message ?? 'Could not create the account.') },
        { status: already ? 409 : 500 },
      )
    }

    const { error: profErr } = await admin.from('Profiles').insert({
      id: created.user.id,
      company_id: company.id,
      Full_name: fullName,
      role: 'agent',
      agent_code: agentCode,
    })
    if (profErr) {
      // Roll back the half-created auth user so a retry isn't blocked.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json({ error: profErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, companyName: company.Name })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signup failed.' }, { status: 500 })
  }
}
