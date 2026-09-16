import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadAgentMap } from '@/lib/api-loaders'

// The company's agents, keyed by agent_code, with the bits the UI needs to
// attribute a listing to a real person and let a colleague reach them:
// real name, avatar colour/initials, and WhatsApp number (when connected).
//
// Company-scoped and authenticated — this is agent-to-agent contact within one
// agency, not a public directory.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agents = await loadAgentMap(admin, session.companyId)

  return NextResponse.json({ agents })
}
