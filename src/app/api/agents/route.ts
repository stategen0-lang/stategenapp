import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManager } from '@/lib/permissions'
import { agentLimitFor } from '@/lib/stripe-plans'

// Managers: agent approvals + team management.
//
//   GET  — { pending: [...], active: [...] } for this company's agents
//   POST — { id, action }
//            approve : mark a pending agent active (enforces the plan cap)
//            reject  : delete a pending signup (profile + auth user)
//            remove  : delete an agent entirely — frees a seat
//
// Managers only, scoped to their own company. Only role='agent' rows can be
// targeted, so owners/managers can never be removed here. Writes use the admin
// client after the session is verified.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('Profiles')
    .select('id, Full_name, agent_code, approved, created_at')
    .eq('company_id', session.companyId)
    .eq('role', 'agent')
    .order('created_at', { ascending: true })

  const rows = data ?? []
  return NextResponse.json({
    pending: rows.filter(r => r.approved === false),
    active: rows.filter(r => r.approved === true),
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  let id: string, action: string
  try {
    const body = await req.json()
    id = String(body.id ?? '')
    action = String(body.action ?? '')
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!id || !['approve', 'reject', 'remove'].includes(action)) {
    return NextResponse.json({ error: 'id and a valid action are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // The target must be an agent in the manager's own company — this is what
  // keeps owners/managers (and other companies' agents) untouchable.
  const { data: target } = await admin
    .from('Profiles')
    .select('id, role, company_id')
    .eq('id', id)
    .maybeSingle()
  if (!target || target.company_id !== session.companyId || target.role !== 'agent') {
    return NextResponse.json({ error: 'Agent not found in your company.' }, { status: 404 })
  }

  // reject (a pending signup) and remove (an active agent) both delete the
  // account; removing frees a seat.
  if (action === 'reject' || action === 'remove') {
    await admin.from('Profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => {})
    return NextResponse.json({ ok: true, action })
  }

  // approve — re-check the plan's cap against approved agents.
  const { data: company } = await admin.from('Companies').select('Plan').eq('id', session.companyId).maybeSingle()
  const limit = agentLimitFor(company?.Plan as string)
  const { count } = await admin
    .from('Profiles')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', session.companyId)
    .eq('role', 'agent')
    .eq('approved', true)
  if (limit !== null && (count ?? 0) >= limit) {
    return NextResponse.json(
      { error: `Your plan allows ${limit} agents and they're all in use. Upgrade to approve more.` },
      { status: 409 },
    )
  }

  const { error } = await admin.from('Profiles').update({ approved: true }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, action: 'approve' })
}
