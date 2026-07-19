'use client'

import { useEffect, useState } from 'react'
import type { Session } from '@/lib/permissions'

// Current user's role + agent code, for deciding what the UI renders.
// Authorisation itself is always enforced server-side.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setSession(d?.session ?? null) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return { session, loading }
}
