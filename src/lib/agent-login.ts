// Turning what somebody typed into the sign-in box into the email Supabase Auth
// actually knows them by.
//
// Agents have no inbox: their login email is synthetic, <code>@<agency domain>,
// and they sign in with just the code ("A2", "NH-779"). The obvious way to
// resolve that is to rebuild the address from the profile's code and the
// company's domain — and that is what this used to do, which was a bug that
// could not be diagnosed from the outside.
//
// The two drift apart. An account made by hand, an agency that changed its
// domain after its agents already existed, a code changed while the company had
// no domain on file: in each case the profile says one thing and auth.users says
// another. A rebuilt address that doesn't exist fails sign-in with "invalid
// credentials" — indistinguishable from a wrong password, so the agent asks for
// a reset, the manager resets it, and it still doesn't work.
//
// So: find the profile by its code, then read that account's REAL email.

import { sanitizeAgentCode } from './agent-code'
import { normalizeDomain } from './domain'

export const GENERIC_LOGIN_ERROR = 'Invalid Agent ID, email or password.'
export const AMBIGUOUS_ID_ERROR =
  'That ID is used at more than one agency. Sign in with your full login email (id@youragency).'

/** Just the slice of the admin client this needs, so it can be tested. */
export type LoginLookupClient = {
  from: (table: string) => any   // eslint-disable-line @typescript-eslint/no-explicit-any
  auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } | null }> } }
}

/**
 * The email to sign in with. Anything containing "@" is already an email and is
 * passed through untouched; anything else is treated as an Agent ID.
 */
export async function resolveLoginEmail(
  admin: LoginLookupClient,
  typed: string,
): Promise<{ email: string } | { error: string }> {
  const raw = String(typed ?? '').trim()
  if (raw.includes('@')) return { email: raw }

  const code = sanitizeAgentCode(raw)
  if (!code) return { error: GENERIC_LOGIN_ERROR }

  const { data: profs } = await admin.from('Profiles').select('id, agent_code, company_id').ilike('agent_code', code)
  // ilike is case-insensitive but also pattern-matching, so compare exactly.
  const matches = (profs ?? []).filter((p: { agent_code?: unknown }) => String(p.agent_code ?? '').toUpperCase() === code)
  if (matches.length === 0) return { error: GENERIC_LOGIN_ERROR }
  // Codes are unique per agency but can repeat across agencies — then we can't
  // tell which one is meant, so ask for the full login email.
  if (matches.length > 1) return { error: AMBIGUOUS_ID_ERROR }

  const profile = matches[0] as { id: string; company_id: number }

  // The authoritative answer: whatever address this account signs in with.
  let real: string | null = null
  try {
    const { data } = await admin.auth.admin.getUserById(profile.id)
    real = data?.user?.email ?? null
  } catch { real = null }
  if (real) return { email: real }

  // Only reached when the auth record can't be read at all (a transient failure
  // of the admin API). Fall back to the convention rather than locking every
  // agent out of ID sign-in while that lasts.
  const { data: company } = await admin.from('Companies').select('domain').eq('id', profile.company_id).maybeSingle()
  const domain = normalizeDomain(company?.domain as string)
  if (!domain) return { error: GENERIC_LOGIN_ERROR }
  return { email: `${code.toLowerCase()}@${domain}` }
}
