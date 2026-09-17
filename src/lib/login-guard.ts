// Shared brute-force guard, used by both the agent login form
// (/api/auth/login-guard) and the admin PIN unlock (/api/admin/verify).
//
// Keyed by whatever identifier the caller passes — an email/Agent ID for
// login, an IP address for the admin PIN (which has no per-user identity to
// key on). After too many failures within a window, the identifier is locked
// out and the platform admins get one email — not re-sent on every retry
// while still locked.
//
// Server-only: uses the service-role client because login runs before any
// session exists (see the RLS note on the login_attempts migration).

import { createAdminClient } from '@/lib/supabase/admin'
import { sendMail } from '@/lib/mailer'

export const THRESHOLD = 8            // failures before lockout + notification
export const WINDOW_MS = 15 * 60_000  // failures older than this don't count toward the streak
export const LOCK_MS = 15 * 60_000    // how long a lockout lasts

const PLATFORM_ADMINS = (process.env.PLATFORM_ADMIN_EMAILS ?? 'stategen0@gmail.com')
  .split(',').map(s => s.trim()).filter(Boolean)

type Row = { identifier: string; fail_count: number; window_start: string; locked_until: string | null; notified_at: string | null }

export function requestIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

async function notify(subject: string, text: string) {
  if (!PLATFORM_ADMINS.length) return
  try { await sendMail({ to: PLATFORM_ADMINS, subject, text }) } catch { /* best-effort */ }
}

export type GuardResult = { blocked: boolean; retryAfterSeconds?: number }

/** Is `identifier` currently locked out? Doesn't record anything. */
export async function checkGuard(identifier: string): Promise<GuardResult> {
  const admin = createAdminClient()
  const { data } = await admin.from('login_attempts').select('*').eq('identifier', identifier).maybeSingle()
  const lockedUntil = (data as Row | null)?.locked_until ? new Date((data as Row).locked_until!).getTime() : 0
  const now = Date.now()
  if (lockedUntil > now) return { blocked: true, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000) }
  return { blocked: false }
}

/** Clear `identifier`'s failure record after a successful attempt. */
export async function recordSuccess(identifier: string): Promise<void> {
  await createAdminClient().from('login_attempts').delete().eq('identifier', identifier)
}

/** Record a failed attempt for `identifier`; locks out + notifies once the
 *  threshold is crossed. `subject`/`describe` shape the notification email. */
export async function recordFailure(
  identifier: string, ip: string, subject: string, describe: (identifier: string, ip: string) => string,
): Promise<GuardResult> {
  const admin = createAdminClient()
  const { data } = await admin.from('login_attempts').select('*').eq('identifier', identifier).maybeSingle()
  const row = data as Row | null
  const now = Date.now()
  const lockedUntil = row?.locked_until ? new Date(row.locked_until).getTime() : 0

  if (lockedUntil > now) {
    // Still locked — don't extend the lock or re-notify on every retry while locked.
    return { blocked: true, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000) }
  }

  const windowStart = row?.window_start ? new Date(row.window_start).getTime() : 0
  const withinWindow = !!row && (now - windowStart) < WINDOW_MS
  const failCount = (withinWindow ? row!.fail_count : 0) + 1
  const newWindowStart = withinWindow ? row!.window_start : new Date(now).toISOString()

  const update: Partial<Row> = { fail_count: failCount, window_start: newWindowStart }
  let result: GuardResult = { blocked: false }

  if (failCount >= THRESHOLD) {
    update.locked_until = new Date(now + LOCK_MS).toISOString()
    result = { blocked: true, retryAfterSeconds: Math.ceil(LOCK_MS / 1000) }

    const lastNotified = row?.notified_at ? new Date(row.notified_at).getTime() : 0
    if (now - lastNotified > LOCK_MS) {
      update.notified_at = new Date(now).toISOString()
      await notify(subject, describe(identifier, ip))
    }
  }

  await admin.from('login_attempts').upsert({ identifier, ...update })
  return result
}
