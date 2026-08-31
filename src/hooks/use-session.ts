'use client'

import { useEffect, useState } from 'react'
import type { Session } from '@/lib/permissions'

// Current user's role + agent code, for deciding what the UI renders.
// Authorisation itself is always enforced server-side.
//
// The session is the same across every page for the life of a browser session
// (login/logout both do a full reload, which resets this module), so we cache it
// at module scope: only the FIRST page pays the /api/me round-trip — every
// client-side navigation after that reads the role instantly instead of blocking
// on the network. Concurrent mounts share one in-flight request.
let cached: Session | null | undefined = undefined   // undefined = not fetched yet
let inflight: Promise<Session | null> | null = null

function fetchSession(): Promise<Session | null> {
  inflight ??= fetch('/api/me')
    .then(r => (r.ok ? r.json() : null))
    .then(d => (d?.session ?? null) as Session | null)
    .catch(() => null)
    .then(s => { cached = s; inflight = null; return s })
  return inflight
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(cached ?? null)
  const [loading, setLoading] = useState(cached === undefined)

  useEffect(() => {
    if (cached !== undefined) { setSession(cached); setLoading(false); return }
    let alive = true
    fetchSession().then(s => { if (alive) { setSession(s); setLoading(false) } })
    return () => { alive = false }
  }, [])

  return { session, loading }
}
