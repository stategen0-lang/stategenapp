import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManager } from '@/lib/permissions'
import { agentLimitFor } from '@/lib/stripe-plans'

// Managers: agent approvals + team management.
//
//   GET  — { pending, active, managers, meId } for this company
//   POST — { id, action }
//            approve : mark a pending agent active (enforces the plan cap)
//            reject  : delete a pending signup (profile + auth user)
//            remove  : delete an agent entirely — frees a seat
//            promote : make an agent a manager (partner) — keeps their code so
//                      they still own their listings/clients
//            demote  : make a manager an agent again (never the last manager)
//
// Managers only, scoped to their own company. Writes use the admin client after
// the session is verified.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('Profiles')
    .select('id, Full_name, agent_code, approved, role, created_at')
    .eq('company_id', session.companyId)
    .order('created_at', { ascending: true })

  const rows = data ?? []
  const agents = rows.filter(r => r.role === 'agent')
  return NextResponse.json({
    pending:  agents.filter(r => r.approved === false),
    active:   agents.filter(r => r.approved === true),
    managers: rows.filter(r => isManager(r.role as string)),
    meId: session.userId,
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
  if (!id || !['approve', 'reject', 'remove', 'promote', 'demote'].includes(action)) {
    return NextResponse.json({ error: 'id and a valid action are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // The target must be in the manager's own company. Which roles are valid
  // targets depends on the action (agents for approve/reject/remove/promote,
  // managers for demote), so we fetch the role and branch on it below.
  const { data: target } = await admin
    .from('Profiles')
    .select('id, role, company_id, agent_code')
    .eq('id', id)
    .maybeSingle()
  if (!target || target.company_id !== session.companyId) {
    return NextResponse.json({ error: 'That person is not in your company.' }, { status: 404 })
  }

  // Counts the plan's agent cap uses; head:true fetches only the count.
  async function approvedAgentCount() {
    const { count } = await admin
      .from('Profiles')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', session!.companyId)
      .eq('role', 'agent')
      .eq('approved', true)
    return count ?? 0
  }
  async function planLimit() {
    const { data: company } = await admin.from('Companies').select('Plan').eq('id', session!.companyId).maybeSingle()
    return agentLimitFor(company?.Plan as string)
  }

  // ── promote an agent to manager (partner) ──────────────────────────────────
  // Keeps their agent_code, so their existing listings/clients stay theirs and
  // the change is reversible (demote). They gain manager access on next sign-in.
  if (action === 'promote') {
    if (target.role !== 'agent') {
      return NextResponse.json({ error: 'Only an agent can be made a manager.' }, { status: 400 })
    }
    const { error } = await admin.from('Profiles').update({ role: 'owner', approved: true }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action })
  }

  // ── demote a manager back to agent ─────────────────────────────────────────
  if (action === 'demote') {
    if (!isManager(target.role as string)) {
      return NextResponse.json({ error: 'That person is not a manager.' }, { status: 400 })
    }
    // A company must always keep at least one manager.
    const { count: managerCount } = await admin
      .from('Profiles')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', session.companyId)
      .in('role', ['owner', 'manager'])
    if ((managerCount ?? 0) <= 1) {
      return NextResponse.json({ error: 'You need at least one manager. Promote someone else first.' }, { status: 409 })
    }
    // They become an agent, so they need an agent code and a free seat.
    if (!target.agent_code) {
      return NextResponse.json({ error: 'This manager has no agent profile, so they can’t become an agent.' }, { status: 409 })
    }
    const limit = await planLimit()
    if (limit !== null && (await approvedAgentCount()) >= limit) {
      return NextResponse.json(
        { error: `Your plan allows ${limit} agents and they're all in use. Upgrade before adding another.` },
        { status: 409 },
      )
    }
    const { error } = await admin.from('Profiles').update({ role: 'agent', approved: true }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action })
  }

  // The remaining actions only ever touch agents.
  if (target.role !== 'agent') {
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
  const limit = await planLimit()
  if (limit !== null && (await approvedAgentCount()) >= limit) {
    return NextResponse.json(
      { error: `Your plan allows ${limit} agents and they're all in use. Upgrade to approve more.` },
      { status: 409 },
    )
  }

  const { error } = await admin.from('Profiles').update({ approved: true }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, action: 'approve' })
}
