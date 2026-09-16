import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession, companyAccessBlocked } from '@/lib/session'
import { loadProperties, loadClients, loadDeals, loadAgentMap } from '@/lib/api-loaders'

// Everything the first screen needs, in ONE request.
//
// The dashboard used to fetch properties, clients, deals and the agent roster
// separately. Each is its own trip to Mumbai (~230ms from Lebanon) and each
// re-ran the session lookup; here the session is resolved once and the four
// queries run together inside the region, so the first paint costs one trip
// instead of four.
//
// It returns exactly what the individual routes return — same masking, same
// private-field stripping (see lib/api-loaders) — so the pages can keep using
// those routes for their own refreshes.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await companyAccessBlocked(session)) {
    return NextResponse.json({ error: "Your agency's access has expired." }, { status: 402 })
  }

  const supabase = await createClient()
  const admin = createAdminClient()

  const [properties, clients, dealsResult, agents] = await Promise.all([
    loadProperties(supabase, session).catch(e => { console.error('[dashboard] properties', e); return [] }),
    loadClients(supabase, session).catch(e => { console.error('[dashboard] clients', e); return [] }),
    loadDeals(supabase, session).catch(e => { console.error('[dashboard] deals', e); return { deals: [], agents: [] } }),
    loadAgentMap(admin, session.companyId).catch(e => { console.error('[dashboard] agents', e); return {} }),
  ])

  return NextResponse.json({
    properties,
    clients,
    deals: dealsResult.deals,
    roster: dealsResult.agents,
    agents,
  })
}
