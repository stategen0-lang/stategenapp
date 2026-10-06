import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { isManager } from '@/lib/permissions'
import { planFor } from '@/lib/stripe-plans'
import { seatsUsed } from '@/lib/seats'

// The "Your plan" card on Settings: which plan the agency is on, what it costs,
// how many of its user slots are taken, and when it is paid through. Read-only —
// plan, price and dates are set by StateGen in the admin panel, never here.
// Managers only: pricing and seat counts are not the agents' business.
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManager(session.role)) return NextResponse.json({ error: 'Managers only.' }, { status: 403 })

  // The manager's own connection: the database rules let them read only their
  // own company's row.
  const supabase = await createClient()
  const { data: company } = await supabase
    .from('Companies')
    .select('Name, Plan, access_status, access_until')
    .eq('id', session.companyId)
    .maybeSingle()

  const plan = planFor(company?.Plan as string | null)
  const usersUsed = await seatsUsed(createAdminClient(), session.companyId)

  return NextResponse.json({
    company: (company?.Name as string) ?? null,
    // null planName = no (or an unrecognised) plan set on the company yet.
    planName: plan?.name ?? null,
    price: plan?.price ?? null,                 // null on Enterprise = custom pricing
    userLimit: plan ? plan.agentLimit : null,   // null on Enterprise = no cap
    usersLabel: plan?.agents ?? null,           // e.g. "10–29 users"
    usersUsed,
    status: (company?.access_status as string) ?? 'active',
    accessUntil: (company?.access_until as string | null) ?? null,
  })
}
