// Server-side: resolve the signed-in user into a permission Session
// (role + agent code). Every API route that returns or mutates company data
// uses this so authorisation is enforced on the server, not just hidden in
// the UI.

import { createClient } from '@/lib/supabase/server'
import { isManager } from '@/lib/permissions'
import type { Role, Session } from '@/lib/permissions'

const COMPANY_ID = Number(process.env.DEMO_COMPANY_ID ?? 1)

// StateGen operators who can reach the /admin panel. Not secret (real
// enforcement is here on the server); env overrides the default.
const PLATFORM_ADMINS = (process.env.PLATFORM_ADMIN_EMAILS ?? 'stategen0@gmail.com')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

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
    .select('company_id, role, agent_code, Full_name, approved')
    .eq('id', user.id)
    .maybeSingle()

  const companyId = Number(profile?.company_id ?? COMPANY_ID)

  // NOTE: the company's billing-access fields are deliberately NOT fetched here.
  // getSession runs on every page and API call, and the access check is only
  // needed in the dashboard layout gate and the /renew screen. Fetching it here
  // added a database round-trip to every request (costly when the DB is a
  // region away). Those two places call getCompanyAccess() instead.

  // A logged-in user with no profile row gets the least privilege we can give
  // them: an agent with no agent code, so they own nothing.
  const role = ((profile?.role as Role) ?? 'agent') as Role
  const email = (user.email ?? '').toLowerCase()
  return {
    userId: user.id,
    companyId,
    role,
    agentCode: (profile?.agent_code as string) ?? null,
    fullName: (profile?.Full_name as string) ?? user.email ?? 'Agent',
    // Managers own the company — never gate them out, even if the flag is off.
    approved: isManager(role) ? true : (profile?.approved === true),
    email,
    isPlatformAdmin: PLATFORM_ADMINS.includes(email),
  }
}

/**
 * A company's manual-billing access, fetched on demand (not in getSession — see
 * the note there). Degrades to 'active' if the columns are missing, so a lagging
 * migration can't lock everyone out.
 */
export async function getCompanyAccess(
  companyId: number,
): Promise<{ status: string; until: string | null }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('Companies')
    .select('access_status, access_until')
    .eq('id', companyId)
    .maybeSingle()
  return {
    status: (data?.access_status as string) ?? 'active',
    until: (data?.access_until as string | null) ?? null,
  }
}
