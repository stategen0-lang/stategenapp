import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { fetchActivity } from '@/lib/activity-server'

// The team activity feed. A manager sees the whole agency; an agent sees only
// their own listings, clients, and deals.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const items = await fetchActivity(admin, {
    companyId: session.companyId,
    agentCode: isManager(session.role) ? null : session.agentCode,
    limit: 40,
  })
  return NextResponse.json({ items })
}
