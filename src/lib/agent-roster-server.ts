// The company's agent roster, loaded once and shared by every screen that
// filters or colours by agent.
//
// Each screen used to derive its own roster from the records it happened to be
// showing. The pipeline built it from deals and listed four agents; the
// calendar built it from events and listed one, because only one agent had
// created an event yet — so a manager could not filter to an agent until that
// agent had something on the screen they were looking at.
//
// The roster is a property of the company, not of the screen.

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildRoster, type RosterAgent } from '@/lib/agent-roster'
import { AGENTS } from '@/lib/data'

/**
 * Every agent in the company: those with a Profile, plus any agent code that
 * owns real records. Deals are used as the ownership source because that is
 * where this app's agent codes actually live — several codes predate their
 * profiles.
 */
export async function loadCompanyRoster(
  supabase: SupabaseClient,
  companyId: number,
): Promise<RosterAgent[]> {
  const [{ data: profiles }, { data: deals }] = await Promise.all([
    supabase.from('Profiles').select('agent_code, Full_name').eq('company_id', companyId),
    supabase.from('deals').select('agent_id').eq('company_id', companyId),
  ])

  return buildRoster(
    (profiles ?? []) as { agent_code: string | null; Full_name: string | null }[],
    (deals ?? []).map(d => (d as { agent_id: string | null }).agent_id),
    AGENTS,
  )
}
