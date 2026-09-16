// Reading how long the signed-in session is still good for, from the cookie
// alone — no network call.
//
// Why: the proxy asked Supabase to verify the session on EVERY page request.
// From Lebanon that call goes to Mumbai and costs ~150ms before the page starts.
// The token itself already carries its expiry, so for the large majority of
// requests — a token minted minutes ago — the proxy can let the request through
// and skip the call. Near expiry (or anything unreadable) it falls back to the
// real verification, which is also what refreshes the token.
//
// What this is NOT: authentication. A request let through on this basis only
// receives the app shell, which contains no data. Every API route independently
// verifies the session server-side (getSession), so a forged or revoked cookie
// gets an empty frame and a 401, never data.
//
// Pure: no imports, no env, no I/O — so every branch can be unit-tested.

export interface CookieLike { name: string; value: string }

/** Supabase stores the session in sb-<project-ref>-auth-token, sometimes split
 *  across .0/.1 chunks when it is too big for one cookie. */
const AUTH_COOKIE = /^sb-.+-auth-token(\.(\d+))?$/

export function authCookieValue(cookies: CookieLike[]): string | null {
  const parts = cookies
    .map(c => ({ c, m: AUTH_COOKIE.exec(c.name) }))
    .filter((x): x is { c: CookieLike; m: RegExpExecArray } => x.m !== null)
  if (!parts.length) return null
  // Chunked cookies are concatenated in index order; an unchunked one is index 0.
  parts.sort((a, b) => Number(a.m[2] ?? 0) - Number(b.m[2] ?? 0))
  const joined = parts.map(p => p.c.value).join('')
  return joined.trim() ? joined : null
}

function fromBase64(raw: string): string | null {
  try {
    // atob exists in the Edge/browser runtimes the proxy runs in; Buffer covers Node.
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(raw)))
    return Buffer.from(raw, 'base64').toString('utf8')
  } catch { return null }
}

/** The `exp` claim of a JWT, in ms, without verifying the signature. */
export function jwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  const json = fromBase64(payload.replace(/-/g, '+').replace(/_/g, '/'))
  if (!json) return null
  try {
    const exp = (JSON.parse(json) as { exp?: number }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch { return null }
}

export interface SessionHint {
  /** A session cookie is present (it may still be invalid or expired). */
  present: boolean
  /** When the access token expires, in ms since epoch — null when unreadable. */
  expiresAt: number | null
}

/**
 * What the cookies say about the session. Handles every shape @supabase/ssr has
 * written: a plain JSON object, a JSON array whose first item is the token, and
 * either of those base64-encoded behind a "base64-" prefix.
 */
export function readSessionHint(cookies: CookieLike[]): SessionHint {
  const raw = authCookieValue(cookies)
  if (!raw) return { present: false, expiresAt: null }

  let text = raw
  if (text.startsWith('base64-')) {
    const decoded = fromBase64(text.slice('base64-'.length))
    if (!decoded) return { present: true, expiresAt: null }
    text = decoded
  }

  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { present: true, expiresAt: null } }

  const session = Array.isArray(parsed) ? parsed[0] : parsed
  if (!session || typeof session !== 'object') return { present: true, expiresAt: null }

  const s = session as { expires_at?: unknown; access_token?: unknown }
  // expires_at is seconds since epoch in every version that writes it.
  if (typeof s.expires_at === 'number' && Number.isFinite(s.expires_at)) {
    return { present: true, expiresAt: s.expires_at * 1000 }
  }
  if (typeof s.access_token === 'string') {
    return { present: true, expiresAt: jwtExpiryMs(s.access_token) }
  }
  return { present: true, expiresAt: null }
}

/** How long before expiry we stop trusting the cookie and verify for real. */
export const REFRESH_WINDOW_MS = 5 * 60_000

/**
 * Can this request skip the verification round-trip?
 *
 * Only when a session cookie is present, its expiry is readable, and it is
 * comfortably in the future. Anything else — no cookie, unreadable, expiring
 * within the window, already expired — takes the slow path, which verifies the
 * session AND refreshes the token.
 */
export function canSkipVerification(hint: SessionHint, now = Date.now(), window = REFRESH_WINDOW_MS): boolean {
  if (!hint.present || hint.expiresAt === null) return false
  return hint.expiresAt - now > window
}

/**
 * The kill switch. Set PROXY_FAST_SESSION=off (in Vercel, no deploy needed) and
 * the proxy verifies every request with Supabase again, exactly as it did before
 * this optimisation. Anything else — unset, empty, 'on' — leaves it enabled.
 */
export function fastSessionEnabled(value: string | undefined): boolean {
  return String(value ?? '').trim().toLowerCase() !== 'off'
}
