import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStage } from '@/lib/pipeline'
import { recalculateScores } from '@/lib/score-engine'
import { getSession } from '@/lib/session'
import { isManager, canSeeDeal, canSeeClientPII, maskClientName } from '@/lib/permissions'
import { type RosterAgent } from '@/lib/agent-roster'
import { loadCompanyRoster } from '@/lib/agent-roster-server'

const COMPANY_ID = Number(process.env.DEMO_COMPANY_ID ?? 1)

// Embed the client (name + lead score) and the property in play so the board
// renders in one trip.
const SELECT =
  '*,client_requests(id,"Client Name",lead_score,agent_rating),Properties(id,Title,Location,Neighborhood,Amenities)'

type Row = Record<string, unknown>

function propertyLabel(p: Row | null): string | null {
  if (!p) return null
  let type = ''
  try { type = (JSON.parse((p.Amenities as string) || '{}').type as string) || '' } catch {}
  const where = [p.Neighborhood, p.Location].filter(Boolean).join(', ')
  return [type || (p.Title as string), where].filter(Boolean).join(' · ') || null
}

function toDeal(row: Row) {
  const client = row.client_requests as Row | null
  const prop = row.Properties as Row | null
  return {
    id: row.id,
    company_id: row.company_id,
    client_id: row.client_id,
    agent_id: row.agent_id,
    property_id: row.property_id,
    stage: row.stage,
    outcome: row.outcome,
    value: Number(row.value) || 0,
    stage_changed_at: row.stage_changed_at,
    created_at: row.created_at,
    clientName: (client?.['Client Name'] as string) ?? 'Unknown client',
    propertyLabel: propertyLabel(prop),
    leadScore: Number(client?.lead_score ?? 0),
    agentRating: Number(client?.agent_rating ?? 3),
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('deals')
      .select(SELECT)
      .eq('company_id', session.companyId)
      .order('value', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Managers see the whole board and may filter to one agent; agents only
    // ever get their own deals, whatever the query string says.
    const agentFilter = isManager(session.role)
      ? req.nextUrl.searchParams.get('agent')
      : null

    const deals = (data ?? [])
      .filter(r => canSeeDeal(session, (r as Row).agent_id as string, agentFilter))
      .map(r => {
        const deal = toDeal(r as Row)
        // Client name on a card is PII — mask it on other agents' deals.
        // (Managers see everything, so this only ever bites an agent.)
        if (!canSeeClientPII(session, (r as Row).agent_id as string)) {
          return { ...deal, clientName: maskClientName(deal.client_id as number), masked: true }
        }
        return deal
      })

    // The roster a manager can filter by, derived from real data rather than a
    // hardcoded list — an agent missing from that list was unfilterable, and
    // their deals rendered under the first demo agent's name.
    // Shared with the calendar so both screens agree on who exists, and so the
    // roster never shrinks just because the board is filtered.
    let agents: RosterAgent[] = await loadCompanyRoster(supabase, session.companyId)

    // An agent gets only their own entry. They still need it — the board draws
    // each card's avatar from the roster, and an empty one rendered every card
    // as unattributed — but the rest of the team is not theirs to enumerate.
    if (!isManager(session.role)) {
      agents = agents.filter(a => a.id === session.agentCode)
    }

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
      .select(SELECT)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // A stage move is a fresh activity signal — refresh that client's score.
    // Non-fatal: scoring must never fail the stage change itself.
    if (stage !== undefined && data?.client_id) {
      try { await recalculateScores({ clientId: Number(data.client_id), companyId: COMPANY_ID }) } catch { /* ignore */ }
    }

    return NextResponse.json({ deal: toDeal(data as Row) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
