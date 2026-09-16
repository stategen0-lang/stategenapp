'use client'

import { useEffect, useState } from 'react'
import type { Session } from '@/lib/permissions'
import { setCacheOwner, readCache, writeCache } from '@/lib/device-cache'

// Current user's role + agent code, for deciding what the UI renders.
// Authorisation itself is always enforced server-side.
//
// The session is the same across every page for the life of a browser session
// (login/logout both do a full reload, which resets this module), so we cache it
// at module scope: only the FIRST page pays the /api/me round-trip — every
// client-side navigation after that reads the role instantly instead of blocking
// on the network. Concurrent mounts share one in-flight request.
let cached: Session | null | undefined = undefined   // undefined = not fetched yet
// The server said 401 (signed out / session no longer valid) — as opposed to the
// request failing because the device is offline. Only the former should bounce
// anyone to the login page.
let signedOut = false
let inflight: Promise<Session | null> | null = null

function fetchSession(): Promise<Session | null> {
  inflight ??= fetch('/api/me')
    .then(r => {
      signedOut = r.status === 401
      return r.ok ? r.json() : null
    })
    .then(d => (d?.session ?? null) as Session | null)
    .catch(() => null)   // offline: keep whatever we had, never sign anyone out
    .then(s => {
      cached = s
      inflight = null
      // Tie any on-device cache to this user: a different user (or none) wipes
      // the previous one's data before a page can read it.
      setCacheOwner(s?.userId ?? null)
      // Kept so the next page paints with the right name/role instead of 'Agent'.
      if (s) writeCache('session', s)
      return s
    })
  return inflight
}

export function useSession() {
  // Seed from the device so the frame renders as the right user immediately;
  // /api/me still runs below and replaces it (and wipes the cache if the user
  // changed). Permissions are never decided here — the server re-checks each call.
  const [session, setSession] = useState<Session | null>(() => cached ?? readCache<Session>('session') ?? null)
  const [loading, setLoading] = useState(() => cached === undefined && readCache<Session>('session') == null)
  // True only once /api/me has actually answered 401.
  const [unauthenticated, setUnauthenticated] = useState(signedOut)

  useEffect(() => {
    if (cached !== undefined) { setSession(cached); setLoading(false); setUnauthenticated(signedOut); return }
    let alive = true
    fetchSession().then(s => { if (alive) { setSession(s); setLoading(false); setUnauthenticated(signedOut) } })
    return () => { alive = false }
  }, [])

  return { session, loading, unauthenticated }
}
