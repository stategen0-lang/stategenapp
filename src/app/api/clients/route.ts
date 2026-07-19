import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recalculateScores } from '@/lib/score-engine'
import { getSession } from '@/lib/session'
import { canSeeClientPII, canEditClient, isManager, maskClientName } from '@/lib/permissions'

const COMPANY_ID = Number(process.env.DEMO_COMPANY_ID ?? 1)

// The owning agent code lives in the client's notes JSON.
function clientAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

// A client change is a scoring signal — refresh that client's lead score.
// Non-fatal: a scoring hiccup must never fail the client write itself.
async function refreshScore(clientId: number) {
  try { await recalculateScores({ clientId, companyId: COMPANY_ID }) } catch { /* ignore */ }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('client_requests')
      .select('*')
      .eq('company_id', session.companyId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Managers may narrow to a single agent; agents are always their own scope.
    const agentFilter = isManager(session.role)
      ? req.nextUrl.searchParams.get('agent')
      : null

    const rows = (data ?? [])
      .filter(r => !agentFilter || clientAgent(r) === agentFilter)
      .map(r => {
        if (canSeeClientPII(session, clientAgent(r))) return r
        // Another agent's client: keep the requirements (so matching still
        // shows demand) but strip the identifying fields.
        let notes = r.notes
        try {
          const parsed = JSON.parse((r.notes as string) || '{}')
          delete parsed.email
          notes = JSON.stringify(parsed)
        } catch { /* leave as-is */ }
        return {
          ...r,
          'Client Name': maskClientName(Number(r.id)),
          'client phone': null,
          notes,
          masked: true,
        }
      })

    return NextResponse.json({ clients: rows })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const supabase = await createClient()

    // Only the owning agent (or a manager) may change a client.
    const { data: existing } = await supabase
      .from('client_requests').select('id,notes').eq('id', id).eq('company_id', session.companyId).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canEditClient(session, clientAgent(existing))) {
      return NextResponse.json({ error: 'Forbidden — this client belongs to another agent' }, { status: 403 })
    }

    // Build a partial update from whatever fields were sent. A status-only
    // payload ({ id, status }) updates just the status; a full edit updates
    // the client details too.
    const update: Record<string, unknown> = {}
    if (body.status !== undefined) update.status = body.status
    if (body.agent_rating !== undefined) {
      const stars = Number(body.agent_rating)
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return NextResponse.json({ error: 'agent_rating must be 1-5' }, { status: 400 })
      }
      update.agent_rating = stars
    }
    if (body.name !== undefined) update['Client Name'] = body.name
    if (body.phone !== undefined) update['client phone'] = body.phone
    if (body.req?.location !== undefined) update['prefered-location'] = body.req.location
    if (body.req?.priceMin !== undefined) update.budget_min = body.req.priceMin
    if (body.budget !== undefined || body.req?.priceMax !== undefined) {
      update.budget_max = body.budget ?? body.req?.priceMax ?? 0
    }
    if (body.req?.beds !== undefined) update.bedrooms = body.req.beds
    if (body.req?.transaction !== undefined) update.payment_terms = body.req.transaction
    if (body.name !== undefined || body.email !== undefined || body.type !== undefined || body.req !== undefined) {
      update.notes = JSON.stringify({ email: body.email, type: body.type, agentId: body.agentId, req: body.req })
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('client_requests')
      .update(update)
      .eq('id', id)
      .eq('company_id', session.companyId)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await refreshScore(Number(id))
    const { data: fresh } = await supabase
      .from('client_requests').select('*').eq('id', id).single()
    return NextResponse.json({ ok: true, client: fresh ?? data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const supabase = await createClient()

    // An agent always creates clients under their own code — they cannot file
    // a client under someone else. Managers may assign explicitly.
    const ownerAgent = isManager(session.role)
      ? (body.agentId ?? null)
      : (session.agentCode ?? body.agentId ?? null)

    // Pack extra UI fields into notes JSON
    const extras = {
      email: body.email,
      type: body.type,
      agentId: ownerAgent,
      req: body.req,
    }

    // Agent_id is a uuid column; the UI's agentId is a mock code like "a1",
    // so only store it when it's an actual uuid (otherwise it lives in notes).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const agentUuid = typeof body.agentId === 'string' && UUID_RE.test(body.agentId) ? body.agentId : null

    const { data, error } = await supabase
      .from('client_requests')
      .insert({
        company_id: session.companyId,
        Agent_id: agentUuid,
        'Client Name': body.name,
        'client phone': body.phone ?? null,
        budget_min: body.req?.priceMin ?? 0,
        budget_max: body.budget ?? body.req?.priceMax ?? 0,
        'prefered-location': body.req?.location ?? null,
        bedrooms: body.req?.beds ?? null,
        payment_terms: body.req?.transaction ?? null,
        notes: JSON.stringify(extras),
        status: body.status ?? 'Searching',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (data?.id) await refreshScore(Number(data.id))
    return NextResponse.json({ client: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
