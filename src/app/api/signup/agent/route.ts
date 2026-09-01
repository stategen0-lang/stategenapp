import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { agentLimitFor } from '@/lib/stripe-plans'
import { seatsUsed } from '@/lib/seats'
import { createAgentAccount } from '@/lib/agent-account'

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
    const fullName = String(body.fullName ?? '').trim()
    const password = String(body.password ?? '')

    if (!domain || !fullName || !password) {
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

    // Enforce the plan's seat cap up front (a pending agent doesn't hold a seat,
    // but if every seat is taken a new signup could never be approved anyway).
    const limit = agentLimitFor(company.Plan as string)
    const used = await seatsUsed(admin, company.id)
    if (limit !== null && used >= limit) {
      return NextResponse.json(
        { error: `${company.Name} has reached its plan's limit of ${limit} users. Ask your manager to upgrade to add more seats.` },
        { status: 409 },
      )
    }

    // Server generates the agent code (regenerating on any collision), so the
    // agent never hits a "that ID is taken" dead-end. Pending until approved.
    const result = await createAgentAccount(admin, {
      companyId: company.id as number,
      companyName: (company.Name as string) ?? 'your agency',
      domain,
      plan: (company.Plan as string) ?? null,
      fullName, password,
      approved: false,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    return NextResponse.json({ ok: true, companyName: company.Name, agentCode: result.agentCode, email: result.email })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Signup failed.' }, { status: 500 })
  }
}
