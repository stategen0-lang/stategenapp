import { NextRequest, NextResponse } from 'next/server'
import { checkGuard, recordFailure, recordSuccess, requestIp, LOCK_MS, THRESHOLD } from '@/lib/login-guard'

// Login rate limiting. The login form (src/app/(auth)/login/page.tsx) calls
// Supabase Auth directly from the browser — there's no server route it goes
// through — so this is the one that stands in front of it:
//
//   check   — before attempting sign-in, ask if this identifier is locked out
//   failure — after a failed attempt, record it; locks out + notifies once
//             the threshold is hit
//   success — after a successful sign-in, clear the identifier's record
//
// Keyed by identifier (the email or Agent ID typed in), not by IP — a phone
// on rotating mobile data has no stable IP, but the account being guessed does.

function normalize(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return s ? s.slice(0, 200) : null
}

function describeLockout(identifier: string, ip: string): string {
  return `${THRESHOLD}+ failed login attempts for "${identifier}" from IP ${ip}.\n\nThe account is temporarily locked out (${LOCK_MS / 60_000} minutes). This may be someone guessing a password — no action is needed unless it keeps happening.`
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const identifier = normalize(body.email)
  const action = body.action
  if (!identifier || !['check', 'success', 'failure'].includes(action)) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }

  if (action === 'success') {
    await recordSuccess(identifier)
    return NextResponse.json({ ok: true })
  }
  if (action === 'check') {
    return NextResponse.json(await checkGuard(identifier))
  }

  const ip = requestIp(req)
  const result = await recordFailure(identifier, ip, `Repeated failed sign-ins: ${identifier}`, describeLockout)
  return NextResponse.json(result)
}
