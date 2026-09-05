import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { canEditClient } from '@/lib/permissions'
import { notifyAgentNewClient } from '@/lib/whatsapp/notify'

// Refer (transfer) a client to another agent in the same company.
//
// The agent who hands the client over is recorded as `referredBy` so they get
// the referral commission, ownership moves to the new agent, and the new agent
// is pinged on WhatsApp to reach out. Only the client's current owner (or a
// manager) may refer it.

function clientAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, toAgent } = await req.json()
    if (!id || !toAgent) return NextResponse.json({ error: 'id and toAgent are required' }, { status: 400 })

    const supabase = await createClient()
    const { data: row } = await supabase
      .from('client_requests')
      .select('*')
      .eq('id', id).eq('company_id', session.companyId)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const currentOwner = clientAgent(row)
    if (!canEditClient(session, currentOwner)) {
      return NextResponse.json({ error: 'Forbidden — this client belongs to another agent' }, { status: 403 })
    }

    // The referrer (who gets the commission) is the agent giving the client away —
    // the current owner, or the person doing it if the client had no owner yet.
    const referrer = currentOwner ?? session.agentCode ?? null
    if (toAgent === referrer) {
      return NextResponse.json({ error: 'That agent already holds this client.' }, { status: 400 })
    }

    // Resolve both agents' real names, and confirm the target is a real agent.
    const admin = createAdminClient()
    const { data: profiles } = await admin
      .from('Profiles')
      .select('agent_code, Full_name')
      .eq('company_id', session.companyId)
      .in('agent_code', [toAgent, referrer].filter(Boolean) as string[])
    const nameOf = (code: string | null) =>
      (profiles?.find(p => p.agent_code === code)?.Full_name as string | undefined) ?? null

    const targetExists = (profiles ?? []).some(p => p.agent_code === toAgent)
    if (!targetExists) return NextResponse.json({ error: 'Unknown agent.' }, { status: 400 })

    const referredByName = nameOf(referrer)

    // Merge onto existing notes so req / email / tags survive the transfer.
    let prev: Record<string, unknown> = {}
    try { prev = JSON.parse((row.notes as string) || '{}') } catch { /* start fresh */ }
    const merged = {
      ...prev,
      agentId: toAgent,
      referredBy: referrer,
      referredByName,
    }

    const { error } = await supabase
      .from('client_requests')
      .update({ notes: JSON.stringify(merged) })
      .eq('id', id).eq('company_id', session.companyId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Ping the NEW agent on WhatsApp — actor is the referrer (≠ new owner), so it
    // sends. Best-effort and non-fatal.
    const companyId = session.companyId
    let notesObj: Record<string, unknown> = {}
    try { notesObj = JSON.parse((row.notes as string) || '{}') } catch {}
    after(async () => {
      try {
        await notifyAgentNewClient({
          companyId,
          ownerAgentCode: toAgent,
          actorAgentCode: referrer,
          client: {
            name: (row['Client Name'] as string) ?? 'A client',
            phone: (row['client phone'] as string) ?? null,
            type: (notesObj.type as string) ?? null,
            budget: (row['budget_max'] as number) ?? null,
            location: (row['prefered-location'] as string) ?? null,
            referredByName,
          },
        })
      } catch { /* notification is best-effort */ }
    })

    return NextResponse.json({ ok: true, toAgent, toAgentName: nameOf(toAgent), referredByName })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
