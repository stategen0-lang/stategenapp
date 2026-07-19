// Server-side: resolve the signed-in user into a permission Session
// (role + agent code). Every API route that returns or mutates company data
// uses this so authorisation is enforced on the server, not just hidden in
// the UI.

import { createClient } from '@/lib/supabase/server'
import type { Role, Session } from '@/lib/permissions'

const COMPANY_ID = Number(process.env.DEMO_COMPANY_ID ?? 1)

export async function getSession(): Promise<Session | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Read the profile with the user's own (authenticated) client. Deliberately
  // NOT the admin client: this runs on every page, and depending on the
  // service-role key here took the whole app down when that key wasn't set in
  // the deployment environment.
  const { data: profile } = await supabase
    .from('Profiles')
    .select('company_id, role, agent_code, Full_name')
    .eq('id', user.id)
    .maybeSingle()

  // A logged-in user with no profile row gets the least privilege we can give
  // them: an agent with no agent code, so they own nothing.
  const role = ((profile?.role as Role) ?? 'agent') as Role
  return {
    userId: user.id,
    companyId: Number(profile?.company_id ?? COMPANY_ID),
    role,
    agentCode: (profile?.agent_code as string) ?? null,
    fullName: (profile?.Full_name as string) ?? user.email ?? 'Agent',
  }
}
