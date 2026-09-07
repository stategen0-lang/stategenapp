import type { SupabaseClient } from '@supabase/supabase-js'
import { generateAgentCode } from './agent-code'

// Managers/owners are also working agents in most agencies, so they need an
// agent_code to OWN listings and clients (ownership, "Mine", matching credit and
// referral commission all key off the code). New managers get one at signup and
// existing ones are backfilled by a migration; this is the belt-and-braces
// safety net that mints one on first write if it's somehow still missing.
//
// Returns the code (existing or newly minted), or null if it couldn't be set.
export async function ensureManagerAgentCode(
  admin: SupabaseClient,
  companyId: number,
  profileId: string,
  fullName: string,
): Promise<string | null> {
  const { data: prof } = await admin
    .from('Profiles').select('agent_code').eq('id', profileId).maybeSingle()
  const existing = prof?.agent_code as string | null | undefined
  if (existing) return existing

  // Avoid colliding with any code already used in this company.
  const { data: rows } = await admin
    .from('Profiles').select('agent_code').eq('company_id', companyId)
  const taken = new Set((rows ?? []).map(r => r.agent_code as string).filter(Boolean))

  for (let i = 0; i < 8; i++) {
    const code = generateAgentCode(fullName || 'Manager')
    if (taken.has(code)) continue
    const { error } = await admin.from('Profiles').update({ agent_code: code }).eq('id', profileId)
    if (!error) return code
  }
  return null
}
