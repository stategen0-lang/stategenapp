import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { canSeeClientPII } from '@/lib/permissions'
import { findClientDupes } from '@/lib/dedupe'

// Duplicate-check for a client about to be created/edited. Runs server-side so
// it can see the WHOLE company (catching a lead another agent already owns)
// without leaking that agent's PII: a match you may not see is returned as a
// nameless "another agent's client" flag — enough to prevent double-entry,
// nothing more.
function clientAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { name?: string; phone?: string; id?: number }
  const name = String(body.name ?? '')
  const phone = String(body.phone ?? '')
  const selfId = body.id != null ? Number(body.id) : undefined
  if (!name.trim() && !phone.trim()) return NextResponse.json({ dupes: [] })

  const supabase = await createClient()
  const { data } = await supabase
    .from('client_requests')
    .select('id, "Client Name", "client phone", notes')
    .eq('company_id', session.companyId)

  const existing = (data ?? []).map(r => ({
    id: Number(r.id),
    name: (r['Client Name'] as string) ?? '',
    phone: (r['client phone'] as string) ?? '',
    agent: clientAgent(r),
  }))

  const dupes = findClientDupes({ name, phone }, existing, selfId).map(h => {
    const mine = canSeeClientPII(session, h.agent)
    // Only reveal the name to someone allowed to see this client's PII.
    return mine ? { id: h.id, name: h.name, mine: true } : { id: h.id, name: null, mine: false }
  })

  return NextResponse.json({ dupes })
}
