import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAgentActivity } from '@/lib/activity-server'
import { summarizeByAgent } from '@/lib/activity'

// Per-agent activity report over a chosen window. Manager-only: this exposes
// every agent's actions, which agents may not see about each other.

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  // Default to the last 7 days if no range is given.
  const now = new Date()
  const defFrom = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  const from = sp.get('from') || defFrom.toISOString()
  const to = sp.get('to') || now.toISOString()
  const agent = sp.get('agent') || null   // a specific agent_code, or null for all

  const admin = createAdminClient()

  const items = await fetchAgentActivity(admin, {
    companyId: session.companyId, from, to, agentCode: agent,
  })
  const byAgent = summarizeByAgent(items)

  // The roster for the picker (every code-bearing person, incl. managers).
  const { data: people } = await admin
    .from('Profiles').select('agent_code, Full_name').eq('company_id', session.companyId)
  const agents = (people ?? [])
    .filter(p => p.agent_code)
    .map(p => ({ code: p.agent_code as string, name: (p.Full_name as string) || (p.agent_code as string) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ from, to, agent, items, byAgent, agents })
}
