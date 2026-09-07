'use client'

import { useEffect, useState } from 'react'

// Stale-while-revalidate cache at module scope: navigating back to a page shows
// the last-loaded data INSTANTLY (no spinner) while a fresh copy loads in the
// background. Survives client-side navigation; a full reload clears it.
const store = new Map<string, unknown>()

export function useCachedFetch<T>(key: string, url: string, opts: { enabled?: boolean } = {}): { data: T | null; loading: boolean; refresh: () => Promise<void> } {
  const enabled = opts.enabled !== false
  const [data, setData] = useState<T | null>((store.get(key) as T) ?? null)
  const [loading, setLoading] = useState(enabled && !store.has(key))

  async function refresh() {
    try {
      const r = await fetch(url)
      if (r.ok) { const j = (await r.json()) as T; store.set(key, j); setData(j) }
    } catch { /* keep what's already on screen */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!enabled) return
    if (store.has(key)) { setData(store.get(key) as T); setLoading(false) }
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url, enabled])

  return { data, loading, refresh }
}

/** Drop cached entries so the next visit refetches (call after a mutation). */
export function invalidateCache(prefix?: string) {
  if (!prefix) { store.clear(); return }
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k)
}
