import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeAgentCode } from '@/lib/agent-code'
import { normalizeDomain } from '@/lib/domain'
import { checkGuard, recordFailure, recordSuccess, requestIp, LOCK_MS, THRESHOLD } from '@/lib/login-guard'

// Sign-in, done on the server. The browser used to call Supabase Auth itself and
// then TELL a separate endpoint whether it had worked — so anyone could report
// "success" to wipe their own failure count, or "failure" to lock out somebody
// else. Here the server checks the lockout, verifies the password and records
// the outcome itself; nothing about the result comes from the caller.
//
// Two counters: per account (the Agent ID / email typed — stops guessing one
// password list at one person) and per IP (stops trying many accounts from one
// place). Either one locks out and emails the platform admins once.
//
// Honest limit: this closes every path through OUR app. Supabase Auth's own
// sign-in API stays reachable with the public key; the Free plan cannot enforce
// our counters there (the password-verification hook is Team/Enterprise only).
// A CAPTCHA enabled in Supabase Auth is what covers that direct route.

const ACCOUNT_THRESHOLD = THRESHOLD   // wrong attempts on one account
const IP_THRESHOLD = 25               // wrong attempts from one IP across accounts
const GENERIC = 'Invalid Agent ID, email or password.'

function describeAccount(identifier: string, ip: string): string {
  return `${ACCOUNT_THRESHOLD}+ failed login attempts for "${identifier}" from IP ${ip}.\n\nThe account is temporarily locked out (${LOCK_MS / 60_000} minutes). This may be someone guessing a password — no action is needed unless it keeps happening.`
}
function describeIp(identifier: string, ip: string): string {
  return `${IP_THRESHOLD}+ failed login attempts from IP ${ip} across different accounts.\n\nThat IP is temporarily locked out (${LOCK_MS / 60_000} minutes). This looks like someone trying many accounts — no action is needed unless it keeps happening.`
}

const locked = (seconds?: number) => NextResponse.json(
  { error: 'Too many failed attempts.', blocked: true, retryAfterSeconds: seconds },
  { status: 429 },
)

// An Agent ID (no "@") is the local part of the agent's synthetic login email,
// <code>@<agency domain>. Returns null when it can't be resolved to one account.
async function emailForAgentId(raw: string): Promise<{ email: string } | { error: string }> {
  const code = sanitizeAgentCode(raw)
  if (!code) return { error: GENERIC }
  const admin = createAdminClient()
  const { data: profs } = await admin.from('Profiles').select('agent_code, company_id').ilike('agent_code', code)
  const matches = (profs ?? []).filter(p => String(p.agent_code ?? '').toUpperCase() === code)
  if (matches.length === 0) return { error: GENERIC }
  // Codes are unique per agency but can repeat across agencies — then we can't
  // tell which one is meant, so ask for the full login email.
  if (matches.length > 1) return { error: 'That ID is used at more than one agency. Sign in with your full login email (id@youragency).' }
  const { data: company } = await admin.from('Companies').select('domain').eq('id', matches[0].company_id).maybeSingle()
  const domain = normalizeDomain(company?.domain as string)
  if (!domain) return { error: GENERIC }
  return { email: `${code.toLowerCase()}@${domain}` }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const typed = typeof body.identifier === 'string' ? body.identifier.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!typed || !password) return NextResponse.json({ error: 'Enter your Agent ID or email and your password.' }, { status: 400 })

  const account = typed.toLowerCase().slice(0, 200)
  const ip = requestIp(req)
  const ipKey = `login-ip:${ip}`

  const [acct, byIp] = await Promise.all([checkGuard(account), checkGuard(ipKey)])
  if (acct.blocked || byIp.blocked) return locked(Math.max(acct.retryAfterSeconds ?? 0, byIp.retryAfterSeconds ?? 0))

  async function fail(message: string) {
    const [a, i] = await Promise.all([
      recordFailure(account, ip, `Repeated failed sign-ins: ${account}`, describeAccount, ACCOUNT_THRESHOLD),
      recordFailure(ipKey, ip, `Repeated failed sign-ins from ${ip}`, describeIp, IP_THRESHOLD),
    ])
    if (a.blocked || i.blocked) return locked(Math.max(a.retryAfterSeconds ?? 0, i.retryAfterSeconds ?? 0))
    return NextResponse.json({ error: message }, { status: 401 })
  }

  let loginEmail = typed
  if (!typed.includes('@')) {
    const r = await emailForAgentId(typed)
    if ('error' in r) return fail(r.error)
    loginEmail = r.email
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password })
  if (error || !data.user) return fail(GENERIC)

  await recordSuccess(account)

  // An agency whose subscription isn't active yet can't sign in.
  const { data: profile } = await supabase.from('Profiles').select('company_id').eq('id', data.user.id).maybeSingle()
  if (profile?.company_id) {
    const { data: company } = await supabase.from('Companies').select('"is active"').eq('id', profile.company_id).maybeSingle()
    if (company && !company['is active']) {
      await supabase.auth.signOut()
      return NextResponse.json(
        { error: 'Your account is pending activation. We will contact you once your subscription is confirmed.' },
        { status: 403 },
      )
    }
  }

  return NextResponse.json({ ok: true })
}
