// Accounts remembered on THIS device for the "Switch account" window.
//
// Only a name and the Agent ID / email typed at sign-in are kept — never a
// password, token or session — so picking a saved account just pre-fills the
// sign-in form; the person still enters the password. Pure except for
// localStorage; unit-tested with a fake store.

export const SAVED_ACCOUNTS_KEY = 'stategen_saved_accounts'
/** Enough for a person with a few logins; keeps the window small. */
export const MAX_SAVED_ACCOUNTS = 5

export interface SavedAccount {
  /** The Agent ID or email as typed at sign-in. */
  id: string
  name: string
  /** When it was last signed in with, for ordering. */
  at: number
}

export interface StoreLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Read a stored value defensively — anything malformed is dropped, never thrown. */
export function parseSaved(raw: string | null | undefined): SavedAccount[] {
  if (!raw) return []
  let data: unknown
  try { data = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(data)) return []
  const out: SavedAccount[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim().slice(0, 200) : ''
    if (!id || out.some(a => same(a.id, id))) continue
    out.push({
      id,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 120) : id,
      at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
    })
  }
  return sortRecent(out).slice(0, MAX_SAVED_ACCOUNTS)
}

function sortRecent(list: SavedAccount[]): SavedAccount[] {
  return [...list].sort((a, b) => b.at - a.at)
}

/** Add or refresh an account (matched ignoring case), most recent first, capped. */
export function upsertAccount(list: SavedAccount[], acc: { id: string; name?: string }, now = Date.now()): SavedAccount[] {
  const id = acc.id.trim()
  if (!id) return list
  const prev = list.find(a => same(a.id, id))
  const entry: SavedAccount = { id, name: (acc.name ?? '').trim() || prev?.name || id, at: now }
  return sortRecent([entry, ...list.filter(a => !same(a.id, id))]).slice(0, MAX_SAVED_ACCOUNTS)
}

export function removeAccount(list: SavedAccount[], id: string): SavedAccount[] {
  return list.filter(a => !same(a.id, id))
}

export function isSameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && same(a, b)
}

/** "Lara Khoury" → "LK"; a single word → its first two letters. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const s = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
  return s.toUpperCase()
}

function store(): StoreLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch { return null }   // private mode / blocked storage
}

export function loadSaved(s: StoreLike | null = store()): SavedAccount[] {
  if (!s) return []
  try { return parseSaved(s.getItem(SAVED_ACCOUNTS_KEY)) } catch { return [] }
}

export function saveSaved(list: SavedAccount[], s: StoreLike | null = store()): void {
  if (!s) return
  try { s.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(list.slice(0, MAX_SAVED_ACCOUNTS))) } catch { /* full / blocked: skip */ }
}

/** Remember an account after a successful sign-in. */
export function rememberAccount(acc: { id: string; name?: string }, s: StoreLike | null = store()): SavedAccount[] {
  const next = upsertAccount(loadSaved(s), acc)
  saveSaved(next, s)
  return next
}
