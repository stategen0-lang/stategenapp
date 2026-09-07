import type { SupabaseClient } from '@supabase/supabase-js'

// Plan seats are counted per *user*, not per agent: every manager/owner and
// every approved agent holds a seat. A pending (unapproved) agent signup does
// not hold one until a manager approves it. Promoting an agent to manager (or
// demoting back) is seat-neutral — they held a seat either way.
//
// One source of truth so signup enforcement, the approve action, and the
// seat-availability display can never drift apart.
export async function seatsUsed(admin: SupabaseClient, companyId: number): Promise<number> {
  const [agents, managers] = await Promise.all([
    admin.from('Profiles').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('role', 'agent').eq('approved', true),
    admin.from('Profiles').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).in('role', ['owner', 'manager']),
  ])
  return (agents.count ?? 0) + (managers.count ?? 0)
}
