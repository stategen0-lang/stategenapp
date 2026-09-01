import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAgentAccount } from '@/lib/agent-account'

// Public: validate + consume a single-use agent invite.
//
//   GET  ?token=…  → { ok, companyName } (does NOT consume) so the join page can
//                    show the agency + form, or an "invalid link" message.
//   POST { token, fullName, password } → atomically claims the invite (so a
//                    second use finds it already consumed), creates the agent
//                    AUTO-APPROVED, and marks the invite used. If account
//                    creation fails, the claim is released so a retry works.

async function loadLiveInvite(admin: ReturnType<typeof createAdminClient>, token: string) {
  const { data } = await admin
    .from('invites')
    .select('id, company_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()
  if (!data) return { error: 'This invite link is not valid.' as const }
  if (data.used_at) return { error: 'This invite link has already been used.' as const }
  if (data.expires_at && new Date(data.expires_at as string).getTime() < Date.now()) {
    return { error: 'This invite link has expired. Ask your manager for a new one.' as const }
  }
  return { invite: data }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ ok: false, error: 'Missing invite token.' }, { status: 400 })

  const admin = createAdminClient()
  const res = await loadLiveInvite(admin, token)
  if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 410 })

  const { data: company } = await admin
    .from('Companies').select('Name').eq('id', res.invite.company_id).maybeSingle()
  return NextResponse.json({ ok: true, companyName: (company?.Name as string) ?? 'the agency' })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { token?: string; fullName?: string; password?: string }
  const token = String(body.token ?? '')
  const fullName = String(body.fullName ?? '').trim()
  const password = String(body.password ?? '')
  if (!token) return NextResponse.json({ error: 'Missing invite token.' }, { status: 400 })

  const admin = createAdminClient()

  // Atomic claim: only ONE concurrent request can flip used_at from null, so the
  // link is truly single-use even under a race.
  const { data: claimed } = await admin
    .from('invites')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)
    .select('id, company_id, expires_at')
    .maybeSingle()

  if (!claimed) {
    return NextResponse.json({ error: 'This invite link is no longer valid — it may have already been used.' }, { status: 410 })
  }
  if (claimed.expires_at && new Date(claimed.expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This invite link has expired.' }, { status: 410 })
  }

  const release = () => admin.from('invites').update({ used_at: null }).eq('id', claimed.id)

  const { data: company } = await admin
    .from('Companies').select('id, Name, domain, Plan').eq('id', claimed.company_id).maybeSingle()
  if (!company) { await release(); return NextResponse.json({ error: 'The agency no longer exists.' }, { status: 404 }) }

  const result = await createAgentAccount(admin, {
    companyId: company.id as number,
    companyName: (company.Name as string) ?? 'your agency',
    domain: (company.domain as string) ?? '',
    plan: (company.Plan as string) ?? null,
    fullName, password,
    approved: true,   // a manager issued the invite, so no separate approval step
  })
  if (!result.ok) {
    await release()   // let them try again with the same link
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  await admin.from('invites').update({ used_by: result.profileId }).eq('id', claimed.id)
  return NextResponse.json({ ok: true, email: result.email, agentCode: result.agentCode, companyName: company.Name })
}
