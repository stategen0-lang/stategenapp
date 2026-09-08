import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeAgentCode } from '@/lib/agent-code'
import { normalizeDomain } from '@/lib/domain'

// Resolve an Agent ID (e.g. "JD-204") to the synthetic login email
// (<code>@<domain>) so agents can sign in with just their ID — they have no real
// inbox. Unauthenticated (it runs before login); it only maps a non-secret ID to
// a derivable email, never reveals anything sensitive.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const code = sanitizeAgentCode(body.id)
  if (!code) return NextResponse.json({ error: 'Enter your Agent ID.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: profs } = await admin
    .from('Profiles').select('agent_code, company_id').ilike('agent_code', code)
  const matches = (profs ?? []).filter(p => String(p.agent_code ?? '').toUpperCase() === code)

  if (matches.length === 0) return NextResponse.json({ error: 'No agent found with that ID. Check it and try again.' }, { status: 404 })
  // Agent codes are unique per company but could repeat across agencies — if so,
  // we can't tell which one, so ask for the full login email.
  if (matches.length > 1) {
    return NextResponse.json({ error: 'That ID is used at more than one agency. Sign in with your full login email (id@youragency).' }, { status: 409 })
  }

  const { data: company } = await admin
    .from('Companies').select('domain').eq('id', matches[0].company_id).maybeSingle()
  const domain = normalizeDomain(company?.domain as string)
  if (!domain) return NextResponse.json({ error: 'Could not resolve your agency. Contact your manager.' }, { status: 500 })

  return NextResponse.json({ email: `${code.toLowerCase()}@${domain}` })
}
