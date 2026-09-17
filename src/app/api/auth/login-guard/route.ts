import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMail } from '@/lib/mailer'

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
// on rotating mobile data has no stable IP, but the account being guessed
// does. Uses the service-role client because this runs before any session
// exists (see the RLS note on the login_attempts table).

const THRESHOLD = 8          // failures before lockout + notification
const WINDOW_MS = 15 * 60_000   // failures older than this don't count toward the streak
const LOCK_MS = 15 * 60_000     // how long a lockout lasts
const PLATFORM_ADMINS = (process.env.PLATFORM_ADMIN_EMAILS ?? 'stategen0@gmail.com')
  .split(',').map(s => s.trim()).filter(Boolean)

type Row = { identifier: string; fail_count: number; window_start: string; locked_until: string | null; notified_at: string | null }

function normalize(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return s ? s.slice(0, 200) : null
}

async function notifyLockout(identifier: string, ip: string) {
  if (!PLATFORM_ADMINS.length) return
  try {
    await sendMail({
      to: PLATFORM_ADMINS,
      subject: `Repeated failed sign-ins: ${identifier}`,
      text: `${THRESHOLD}+ failed login attempts for "${identifier}" from IP ${ip}.\n\nThe account is temporarily locked out (${LOCK_MS / 60_000} minutes). This may be someone guessing a password — no action is needed unless it keeps happening.`,
    })
  } catch { /* best-effort — never block the login flow on a notification failure */ }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const identifier = normalize(body.email)
  const action = body.action
  if (!identifier || !['check', 'success', 'failure'].includes(action)) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }

  const admin = createAdminClient()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'

  if (action === 'success') {
    await admin.from('login_attempts').delete().eq('identifier', identifier)
    return NextResponse.json({ ok: true })
  }

  const { data } = await admin.from('login_attempts').select('*').eq('identifier', identifier).maybeSingle()
  const row = data as Row | null
  const now = Date.now()
  const lockedUntil = row?.locked_until ? new Date(row.locked_until).getTime() : 0

  if (action === 'check') {
    if (lockedUntil > now) {
      return NextResponse.json({ blocked: true, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000) })
    }
    return NextResponse.json({ blocked: false })
  }

  // action === 'failure'
  if (lockedUntil > now) {
    // Still locked — don't extend the lock or re-notify on every retry while locked.
    return NextResponse.json({ blocked: true, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000) })
  }

  const windowStart = row?.window_start ? new Date(row.window_start).getTime() : 0
  const withinWindow = row && (now - windowStart) < WINDOW_MS
  const failCount = (withinWindow ? row!.fail_count : 0) + 1
  const newWindowStart = withinWindow ? row!.window_start : new Date(now).toISOString()

  const update: Partial<Row> = { fail_count: failCount, window_start: newWindowStart }
  let blocked = false
  let retryAfterSeconds: number | undefined

  if (failCount >= THRESHOLD) {
    const until = new Date(now + LOCK_MS)
    update.locked_until = until.toISOString()
    blocked = true
    retryAfterSeconds = Math.ceil(LOCK_MS / 1000)

    const lastNotified = row?.notified_at ? new Date(row.notified_at).getTime() : 0
    if (now - lastNotified > LOCK_MS) {
      update.notified_at = new Date(now).toISOString()
      await notifyLockout(identifier, ip)
    }
  }

  await admin.from('login_attempts').upsert({ identifier, ...update })
  return NextResponse.json({ blocked, retryAfterSeconds })
}
