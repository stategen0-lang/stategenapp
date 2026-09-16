// Last-known data kept on the device, so a page paints instantly instead of
// waiting on the network.
//
// Why it matters here: the app's servers sit next to the database in Mumbai, so
// every data call from Lebanon costs ~230 ms before any work happens. Reading
// the previous answer from localStorage costs ~0 ms, so the agent sees their
// listings/clients immediately and the fresh copy replaces them a moment later
// (stale-while-revalidate).
//
// Rules that keep this safe:
//   • Scoped per signed-in user, and wiped on sign-out — one device can be
//     shared, and this holds client contact details.
//   • Cached data is never the final word: every read is followed by a real
//     request, and anything older than MAX_AGE_MS is ignored.
//   • Failures are silent (private mode, full storage): the app just waits for
//     the network as it did before.
//
// Pure except for localStorage; unit-tested with a fake store.

const PREFIX = 'sg.cache.'
const OWNER_KEY = `${PREFIX}owner`
/** Older than this and we'd rather show nothing than something misleading. */
export const MAX_AGE_MS = 24 * 60 * 60_000
/** Skip anything big enough to slow the page down or fill the quota. */
const MAX_BYTES = 1_500_000

export interface StoreLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(i: number): string | null
  readonly length: number
}

function store(): StoreLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch { return null }   // private mode / blocked storage
}

/** Every key this module owns, for wiping. */
function ourKeys(s: StoreLike): string[] {
  const keys: string[] = []
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i)
    if (k && k.startsWith(PREFIX)) keys.push(k)
  }
  return keys
}

export function clearDeviceCache(s: StoreLike | null = store()): void {
  if (!s) return
  try { for (const k of ourKeys(s)) s.removeItem(k) } catch { /* ignore */ }
}

/**
 * Tie the cache to a user. Called on every session read: if the signed-in user
 * changed (or signed out), the previous user's data is wiped first.
 */
export function setCacheOwner(userId: string | null, s: StoreLike | null = store()): void {
  if (!s) return
  try {
    const prev = s.getItem(OWNER_KEY)
    if (prev === (userId ?? '')) return
    clearDeviceCache(s)
    if (userId) s.setItem(OWNER_KEY, userId)
  } catch { /* ignore */ }
}

/** The last saved value for `key`, or null when missing, stale or unreadable. */
export function readCache<T>(key: string, now = Date.now(), s: StoreLike | null = store()): T | null {
  if (!s) return null
  try {
    const raw = s.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; data?: T }
    if (!parsed || typeof parsed.at !== 'number' || parsed.data === undefined) return null
    if (now - parsed.at > MAX_AGE_MS) { s.removeItem(PREFIX + key); return null }
    return parsed.data
  } catch { return null }
}

export function writeCache<T>(key: string, data: T, now = Date.now(), s: StoreLike | null = store()): void {
  if (!s) return
  try {
    const raw = JSON.stringify({ at: now, data })
    if (raw.length > MAX_BYTES) return
    s.setItem(PREFIX + key, raw)
  } catch {
    // Out of quota: drop everything we own and try once more, so one huge page
    // can't permanently break caching for the others.
    try { clearDeviceCache(s); s.setItem(PREFIX + key, JSON.stringify({ at: now, data })) } catch { /* give up */ }
  }
}
