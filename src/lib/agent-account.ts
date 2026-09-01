import type { SupabaseClient } from '@supabase/supabase-js'
import { generateAgentCode } from './agent-code'
import { agentLimitFor } from './stripe-plans'
import { seatsUsed } from './seats'

// One place that creates an agent's account (auth user + Profile), used by the
// public agent signup, the single-use invite accept, and manager-creates-agent.
//
// Fixes the old collision dead-end: if the generated <code>@<domain> email is
// already taken, it regenerates the code and retries instead of failing.

interface CreateAgentOpts {
  companyId: number
  companyName: string
  domain: string          // has a dot, so <code>@<domain> is a valid email
  plan: string | null
  fullName: string
  password: string
  approved: boolean       // invites + manager-create are pre-approved; public signup is not
}

export type CreateAgentResult =
  | { ok: true; agentCode: string; email: string; profileId: string }
  | { ok: false; error: string; status: number }

export async function createAgentAccount(admin: SupabaseClient, opts: CreateAgentOpts): Promise<CreateAgentResult> {
  const { companyId, companyName, domain, plan, fullName, password, approved } = opts
  if (!fullName.trim()) return { ok: false, error: 'A full name is required.', status: 400 }
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.', status: 400 }

  // Only an APPROVED account holds a seat; a pending signup does not until a
  // manager approves it.
  if (approved) {
    const limit = agentLimitFor(plan)
    if (limit !== null) {
      const used = await seatsUsed(admin, companyId)
      if (used >= limit) {
        return { ok: false, error: `${companyName} has reached its plan's limit of ${limit} users. Ask your manager to upgrade to add more seats.`, status: 409 }
      }
    }
  }

  // Create the auth user, regenerating the agent code on collision.
  for (let attempt = 0; attempt < 6; attempt++) {
    const agentCode = generateAgentCode(fullName)
    const email = `${agentCode.toLowerCase()}@${domain}`
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (authErr || !created?.user) {
      if (/already|registered|exists/i.test(authErr?.message ?? '')) continue   // collision → new code
      return { ok: false, error: authErr?.message ?? 'Could not create the account.', status: 500 }
    }
    const { error: profErr } = await admin.from('Profiles').insert({
      id: created.user.id, company_id: companyId, Full_name: fullName,
      role: 'agent', agent_code: agentCode, approved,
    })
    if (profErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return { ok: false, error: profErr.message, status: 500 }
    }
    return { ok: true, agentCode, email, profileId: created.user.id }
  }
  return { ok: false, error: 'Could not generate a unique agent ID — please try again.', status: 409 }
}
