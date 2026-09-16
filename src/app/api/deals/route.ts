import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStage } from '@/lib/pipeline'
import { recalculateScores } from '@/lib/score-engine'
import { getSession, companyAccessBlocked } from '@/lib/session'
import { loadDeals, toDeal, DEAL_SELECT } from '@/lib/api-loaders'
import { isManager } from '@/lib/permissions'


type Row = Record<string, unknown>

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const supabase = await createClient()
    const agentFilter = req.nextUrl.searchParams.get('agent')
    // NB: offer badges load separately (GET /api/offers/summary) so this
    // response — which the board blocks on — stays a single fast query.
    const { deals, agents } = await loadDeals(supabase, session, agentFilter)
    return NextResponse.json({ deals, agents })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Move a deal to a new stage (and set the won/lost outcome when closing).
// stage_changed_at + stage_history are handled by a DB trigger.
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // An expired/suspended agency reads and writes nothing (the UI also redirects
    // to /renew, but that is only a redirect — this is the rule).
    if (await companyAccessBlocked(session)) {
      return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
    }

    const body = await req.json()
    const { id, stage, outcome } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (stage !== undefined && !isStage(stage)) {
      return NextResponse.json({ error: `invalid stage: ${stage}` }, { status: 400 })
    }

    const update: Row = {}
    if (stage !== undefined) {
      update.stage = stage
      // Outcome only applies to a closed deal — clear it when moving back out.
      if (stage !== 'closed') update.outcome = null
    }
    if (outcome !== undefined) {
      if (outcome !== null && outcome !== 'won' && outcome !== 'lost') {
        return NextResponse.json({ error: `invalid outcome: ${outcome}` }, { status: 400 })
      }
      update.outcome = outcome
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const supabase = await createClient()

    // Agents may only move their own deals.
    const { data: existing } = await supabase
      .from('deals').select('id,agent_id').eq('id', id).eq('company_id', session.companyId).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!isManager(session.role) && (existing as Row).agent_id !== session.agentCode) {
      return NextResponse.json({ error: 'Forbidden — this deal belongs to another agent' }, { status: 403 })
    }

    const { data, error } = await supabase
      .from('deals')
      .update(update)
      .eq('id', id)
      .eq('company_id', session.companyId)
      .select(DEAL_SELECT)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // A stage move is a fresh activity signal — refresh that client's score.
    // Deferred with after() so the move returns instantly; the score lands a
    // moment later. Non-fatal: scoring must never fail the stage change itself.
    if (stage !== undefined && data?.client_id) {
      const clientId = Number(data.client_id)
      after(async () => { try { await recalculateScores({ clientId, companyId: session.companyId }) } catch { /* ignore */ } })
    }

    return NextResponse.json({ deal: toDeal(data as Row) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
