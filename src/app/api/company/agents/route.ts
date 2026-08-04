import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { colorFor } from '@/lib/agent-roster'

// The company's agents, keyed by agent_code, with the bits the UI needs to
// attribute a listing to a real person and let a colleague reach them:
// real name, avatar colour/initials, and WhatsApp number (when connected).
//
// Company-scoped and authenticated — this is agent-to-agent contact within one
// agency, not a public directory.
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('Profiles')
    .select('agent_code, Full_name, whatsapp_number, whatsapp_enabled, role')
    .eq('company_id', session.companyId)

  const agents: Record<string, { name: string; initials: string; color: string; whatsapp: string | null }> = {}
  for (const p of data ?? []) {
    const code = p.agent_code as string | null
    if (!code) continue   // owners/managers own no code-tagged listings
    const name = (p.Full_name as string) || code
    agents[code] = {
      name,
      initials: initialsOf(name),
      color: colorFor(code),
      // Only surface a number an agent can actually be reached on.
      whatsapp: (p.whatsapp_enabled !== false && p.whatsapp_number) ? (p.whatsapp_number as string) : null,
    }
  }

  return NextResponse.json({ agents })
}
