import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { agentLimitFor } from '@/lib/stripe-plans'
import { seatsUsed } from '@/lib/seats'

// How many agent seats a company has used vs its plan cap. Used by the agent
// signup page to show availability before the form is filled. (Authoritative
// enforcement is in /api/signup/agent; this is for UX.)
export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain')?.toLowerCase().trim()
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: company } = await admin
    .from('Companies').select('id, Plan').eq('domain', domain).maybeSingle()
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const limit = agentLimitFor(company.Plan as string)
  // A seat is used by every active user: managers + approved agents. Pending
  // agent signups don't count until a manager approves them.
  const used = await seatsUsed(admin, company.id)

  return NextResponse.json({ used, limit, full: limit !== null && used >= limit })
}
