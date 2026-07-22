import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { validateEvent, type CalendarEvent } from '@/lib/calendar'
import { type RosterAgent } from '@/lib/agent-roster'
import { loadCompanyRoster } from '@/lib/agent-roster-server'

// Calendar events. Ownership follows the rest of the app:
//
//   manager — sees every agent's events and may filter to one
//   agent   — sees and edits only their own, whatever the query string says
//
// The filter is applied server-side. Doing it in the browser would ship every
// agent's schedule to every agent and call it a filter.

type Row = Record<string, unknown>

function toEvent(row: Row, agentName?: string): CalendarEvent {
  const client = row.client_requests as Row | null
  return {
    id: row.id as string,
    company_id: row.company_id as number,
    profile_id: row.profile_id as string,
    agent_code: (row.agent_code as string) ?? null,
    title: (row.title as string) ?? '',
    notes: (row.notes as string) ?? null,
    kind: (row.kind as CalendarEvent['kind']) ?? 'other',
    starts_at: row.starts_at as string,
    ends_at: row.ends_at as string,
    all_day: !!row.all_day,
    location: (row.location as string) ?? null,
    client_id: (row.client_id as number) ?? null,
    property_id: (row.property_id as number) ?? null,
    agentName,
    clientName: (client?.['Client Name'] as string) ?? null,
  }
}

const SELECT = '*,client_requests(id,"Client Name")'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient()
    const { searchParams } = req.nextUrl

    let query = supabase
      .from('calendar_events')
      .select(SELECT)
      .eq('company_id', session.companyId)
      .order('starts_at', { ascending: true })

    // The visible grid, so a month view doesn't download a year.
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from) query = query.gte('starts_at', from)
    if (to) query = query.lte('starts_at', to)

    // An agent is pinned to their own events regardless of ?agent=.
    const requested = searchParams.get('agent')
    const agentFilter = isManager(session.role) ? requested : session.agentCode
    if (agentFilter) query = query.eq('agent_code', agentFilter)
    // A non-manager with no agent code owns nothing; scope by profile so they
    // can still see events they created rather than the whole company's.
    if (!isManager(session.role) && !session.agentCode) query = query.eq('profile_id', session.userId)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // The company's roster, not one derived from the events on screen —
    // otherwise an agent with no events yet cannot be filtered to at all.
    let agents: RosterAgent[] = await loadCompanyRoster(supabase, session.companyId)
    // Agents get only themselves — enough to colour their own events, not
    // enough to enumerate the team.
    if (!isManager(session.role)) agents = agents.filter(a => a.id === session.agentCode)

    const nameOf = new Map(agents.map(a => [a.id, a.name]))

    // Managers have no agent_code, so their own events would otherwise show as
    // unattributed. Fall back to the owning profile's name.
    const { data: people } = await supabase
      .from('Profiles')
      .select('id, Full_name')
      .eq('company_id', session.companyId)
    const personOf = new Map((people ?? []).map(p => [p.id as string, p.Full_name as string]))

    const events = (data ?? []).map(r => {
      const row = r as Row
      const byCode = nameOf.get(row.agent_code as string)
      return toEvent(row, byCode ?? personOf.get(row.profile_id as string) ?? undefined)
    })

    return NextResponse.json({ events, agents })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const draft = await req.json()
    const result = validateEvent(draft)
    if (!result.ok) return NextResponse.json({ error: result.errors.join(' ') }, { status: 400 })

    // Ownership is taken from the session, never from the request body — a
    // posted profile_id would let anyone write into someone else's calendar.
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('calendar_events')
      .insert({
        ...result.value,
        company_id: session.companyId,
        profile_id: session.userId,
        agent_code: session.agentCode,
      })
      .select(SELECT)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ event: toEvent(data as Row, session.fullName) }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** Can this session change that event? Managers: any. Agents: their own only. */
async function ownedOr403(supabase: Awaited<ReturnType<typeof createClient>>, session: NonNullable<Awaited<ReturnType<typeof getSession>>>, id: string) {
  const { data: existing } = await supabase
    .from('calendar_events')
    .select('id, profile_id, company_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (existing.company_id !== session.companyId) {
    // Another company's event: report it as missing rather than confirming it exists.
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (!isManager(session.role) && existing.profile_id !== session.userId) {
    return { error: NextResponse.json({ error: 'That event belongs to another agent.' }, { status: 403 }) }
  }
  return { existing }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { id, ...draft } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const supabase = await createClient()
    const guard = await ownedOr403(supabase, session, id)
    if (guard.error) return guard.error

    const result = validateEvent(draft)
    if (!result.ok) return NextResponse.json({ error: result.errors.join(' ') }, { status: 400 })

    const { data, error } = await supabase
      .from('calendar_events')
      .update(result.value)
      .eq('id', id)
      .select(SELECT)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ event: toEvent(data as Row) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const supabase = await createClient()
    const guard = await ownedOr403(supabase, session, id)
    if (guard.error) return guard.error

    const { error } = await supabase.from('calendar_events').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
