import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import type { AlertView } from '@/lib/alerts'

// New-listing match alerts. An agent sees alerts for their own clients; a
// manager sees the whole company's.

type Row = Record<string, unknown>

function propertyLabel(p: Row | null): { title: string; label: string } {
  if (!p) return { title: 'Listing', label: '' }
  let type = ''
  try { type = (JSON.parse((p.Amenities as string) || '{}').type as string) || '' } catch {}
  const where = [p.Neighborhood, p.Location].filter(Boolean).join(', ')
  return {
    title: (p.Title as string) || 'Listing',
    label: [type, where].filter(Boolean).join(' · '),
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  let query = supabase
    .from('listing_alerts')
    .select('id, score, seen, created_at, property_id, client_id, agent_code, Properties(Title, Location, Neighborhood, Amenities), client_requests("Client Name")')
    .eq('company_id', session.companyId)
    .order('created_at', { ascending: false })
    .limit(200)

  // An agent only ever sees alerts for their own clients.
  if (!isManager(session.role)) query = query.eq('agent_code', session.agentCode)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Managers see whose client each alert is for; resolve codes to names.
  let nameOf = new Map<string, string>()
  if (isManager(session.role)) {
    const { data: people } = await supabase
      .from('Profiles').select('agent_code, Full_name').eq('company_id', session.companyId)
    nameOf = new Map((people ?? []).filter(p => p.agent_code).map(p => [p.agent_code as string, p.Full_name as string]))
  }

  const alerts: AlertView[] = (data ?? []).map(r => {
    const row = r as Row
    const prop = propertyLabel(row.Properties as Row | null)
    const client = row.client_requests as Row | null
    return {
      id: row.id as string,
      score: Number(row.score) || 0,
      seen: !!row.seen,
      created_at: row.created_at as string,
      propertyId: (row.property_id as number) ?? null,
      propertyTitle: prop.title,
      propertyLabel: prop.label,
      clientId: (row.client_id as number) ?? null,
      clientName: (client?.['Client Name'] as string) ?? 'Client',
      agentName: isManager(session.role) ? nameOf.get(row.agent_code as string) : undefined,
    }
  })

  const unseen = alerts.filter(a => !a.seen).length
  return NextResponse.json({ alerts, unseen })
}

// Mark alerts seen: { id } for one, or { all: true } for everything visible.
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const supabase = await createClient()

  let query = supabase.from('listing_alerts').update({ seen: true }).eq('company_id', session.companyId)
  // Scope the write the same way as the read: an agent can only clear their own.
  if (!isManager(session.role)) query = query.eq('agent_code', session.agentCode)

  if (body.id) query = query.eq('id', body.id)
  else if (!body.all) return NextResponse.json({ error: 'id or all required' }, { status: 400 })

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
