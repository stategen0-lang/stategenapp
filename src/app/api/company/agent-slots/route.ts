import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { agentLimitFor } from '@/lib/stripe-plans'
import { seatsUsed } from '@/lib/seats'
import { normalizeDomain } from '@/lib/domain'

// Resolve a company by domain for the agent signup page: whether it exists, its
// name, and how many agent seats are left. This is the single source of truth for
// the page's "did we find your agency?" check — done here on the server with the
// admin client (not a direct browser query) so it isn't affected by RLS, and by
// NORMALISED domain so casing / www / protocol / invisible pasted characters
// can't hide an agency from its own agents.
export async function GET(req: NextRequest) {
  const domain = normalizeDomain(req.nextUrl.searchParams.get('domain'))
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: rows } = await admin.from('Companies').select('id, Name, Plan, domain')
  const company = (rows ?? []).find(c => normalizeDomain(c.domain as string) === domain)
  if (!company) return NextResponse.json({ found: false })

  const limit = agentLimitFor(company.Plan as string)
  // A seat is used by every active user: managers + approved agents. Pending
  // agent signups don't count until a manager approves them.
  const used = await seatsUsed(admin, company.id)

  return NextResponse.json({
    found: true,
    id: company.id,
    name: company.Name,
    used,
    limit,
    full: limit !== null && used >= limit,
  })
}
