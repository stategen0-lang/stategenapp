// Finding and opening an existing listing over WhatsApp.
//
//   "find the listing of Georges Khoury"   → search
//   "edit the property of Khoury"          → search, then open it
//   "villa in Kaslik owner Haddad price 1.2m" (update with no #number)
//                                          → search, then stage the change
//
// One match opens the listing ("focus"), so the next message — "price 300k",
// "mark sold", "send me the link" — applies to it without typing its number.
// Several matches give a numbered list; the reply number opens that one (and
// applies a pending change, if the request carried one).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntentResult } from '@/lib/whatsapp/intent'
import type { Profile } from '@/lib/whatsapp/write-handlers'
import { searchListings } from '@/lib/listing-search'
import { hitLine, describeQuery, hasCriteria, type ListingQuery, type ListingHit } from '@/lib/listing-search-core'

const SHOWN = 8
const FOCUS = 'listing_focus'
const PICK = 'pick_listing'
const FOCUS_MS = 60 * 60_000     // an opened listing stays "current" for an hour

interface PickCandidate { id: number; line: string; title: string }
type PendingFields = Record<string, string | number | boolean>

/** Build a search from what the model (or the quick matcher) extracted. */
export function queryFromIntent(intent: IntentResult): ListingQuery {
  const f = intent.fields ?? {}
  const text = [intent.search, typeof f.search === 'string' ? f.search : null].filter(Boolean).join(' ')
  const tx = String(f.transaction ?? '').toLowerCase()
  return {
    text: text || undefined,
    location: intent.location,
    type: typeof f.type === 'string' ? canonicalType(f.type) : undefined,
    transaction: /rent/.test(tx) ? 'For Rent' : /sale|sell|buy/.test(tx) ? 'For Sale' : undefined,
    beds: Number(f.beds) > 0 ? Number(f.beds) : undefined,
    maxPrice: Number(intent.budget ?? f.maxPrice) > 0 ? Number(intent.budget ?? f.maxPrice) : undefined,
    minPrice: Number(f.minPrice) > 0 ? Number(f.minPrice) : undefined,
    status: typeof f.status === 'string' && /^(available|reserved|sold|rented)$/i.test(f.status)
      ? f.status.charAt(0).toUpperCase() + f.status.slice(1).toLowerCase() : undefined,
  }
}

function canonicalType(t: string): string | undefined {
  const s = t.trim().toLowerCase()
  const map: Record<string, string> = { apartment: 'Appartement', appartment: 'Appartement', flat: 'Appartement', apt: 'Appartement', house: 'Villa', store: 'Shop' }
  if (map[s]) return map[s]
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : undefined
}

async function setState(admin: SupabaseClient, profile: Profile, flow: string, context: Record<string, unknown>) {
  await admin.from('conversation_state').upsert({
    company_id: profile.company_id, profile_id: profile.id,
    current_flow: flow, step: flow, context, updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' })
}

async function readState(admin: SupabaseClient, profile: Profile) {
  const { data } = await admin
    .from('conversation_state').select('current_flow, context, updated_at').eq('profile_id', profile.id).maybeSingle()
  return data as { current_flow: string; context: Record<string, unknown> | null; updated_at: string } | null
}

/** Open a listing: later messages without a #number apply to it. */
export async function focusListing(admin: SupabaseClient, profile: Profile, hit: { id: number; title: string }) {
  await setState(admin, profile, FOCUS, { propertyId: hit.id, title: hit.title })
}

/** The listing the agent opened in the last hour, if any. */
export async function focusedListing(admin: SupabaseClient, profile: Profile): Promise<{ id: number; title: string } | null> {
  const st = await readState(admin, profile)
  if (!st || st.current_flow !== FOCUS) return null
  if (Date.now() - new Date(st.updated_at).getTime() > FOCUS_MS) return null
  const id = Number(st.context?.propertyId)
  return id > 0 ? { id, title: String(st.context?.title ?? `#${id}`) } : null
}

function openedText(h: ListingHit | { id: number; title: string }, lead = 'Opened'): string {
  const line = 'score' in h ? hitLine(h) : `#${h.id} ${h.title}`
  return [
    `📂 ${lead}: ${line}`,
    '',
    'What would you like to do? For example:',
    '• "price 300k" or "mark sold"',
    '• "it has a generator and parking"',
    '• "photos" — then send them',
    '• "send me the link" · "send to marketing"',
  ].join('\n')
}

function pickText(hits: ListingHit[], total: number, capped: boolean, query: ListingQuery): string {
  const shown = hits.slice(0, SHOWN)
  const more = total > SHOWN || capped
  return [
    `${capped ? `${SHOWN}+` : total} listings match ${describeQuery(query)}${more ? ` — showing the best ${shown.length}` : ''}:`,
    '',
    ...shown.map((h, i) => `${i + 1}. ${hitLine(h)}`),
    '',
    more
      ? 'Reply with a number, or narrow it down (add the area, bedrooms, price or more of the owner\'s name).'
      : 'Reply with the number.',
  ].join('\n')
}

/**
 * Run a search and act on the result count. With `pending` (an update that had
 * no #number), a single match returns its id so the caller can stage the change;
 * otherwise a single match is opened.
 */
export async function findListings(
  admin: SupabaseClient, profile: Profile, query: ListingQuery, pending?: PendingFields,
): Promise<{ reply: string; resolvedId?: number }> {
  if (!hasCriteria(query)) {
    return { reply: 'Which listing? Tell me something about it — the owner\'s name or phone, words from the title, or the area. e.g. "find the listing of Georges Khoury" or "#23".' }
  }
  const viewer = { companyId: profile.company_id, role: profile.role as 'owner' | 'manager' | 'agent', agentCode: profile.agent_code }
  const { hits, capped } = await searchListings(admin, viewer, query)

  if (!hits.length) {
    return { reply: `No listings match ${describeQuery(query)}.\n\nTry part of the owner's name, a word from the title, the area, or the listing number (#23).${profile.role === 'agent' ? '\n(Owner names and phones are searched on your own listings.)' : ''}` }
  }

  if (hits.length === 1) {
    if (pending) return { reply: '', resolvedId: hits[0].id }
    await focusListing(admin, profile, hits[0])
    return { reply: openedText(hits[0], 'Found') }
  }

  const candidates: PickCandidate[] = hits.slice(0, SHOWN).map(h => ({ id: h.id, line: hitLine(h), title: h.title }))
  await setState(admin, profile, PICK, { candidates, pending: pending ?? null })
  return { reply: pickText(hits, hits.length, capped, query) }
}

/**
 * The numeric reply to a "which listing?" list. Returns null when no list is
 * open, or when the agent typed something else (e.g. a narrower search), so the
 * message is routed normally.
 */
export async function continueListingPick(
  admin: SupabaseClient, profile: Profile, body: string,
  applyPending: (propertyId: number, fields: PendingFields) => Promise<string>,
): Promise<string | null> {
  const st = await readState(admin, profile)
  if (!st || st.current_flow !== PICK) return null
  const clear = () => admin.from('conversation_state').delete().eq('profile_id', profile.id)
  if (Date.now() - new Date(st.updated_at).getTime() > FOCUS_MS) { await clear(); return null }

  const candidates = (st.context?.candidates ?? []) as PickCandidate[]
  const pending = (st.context?.pending ?? null) as PendingFields | null
  const t = body.trim()
  if (/^(cancel|abort|nevermind|never mind|quit)\b/i.test(t)) { await clear(); return 'Okay, cancelled.' }

  const m = t.match(/^#?\s*(\d{1,3})\s*$/)
  if (!m) { await clear(); return null }          // not a pick — let it route (e.g. a refined search)
  const n = Number(m[1])
  if (n < 1 || n > candidates.length) {
    return `Please reply with a number between 1 and ${candidates.length}.\n\n${candidates.map((c, i) => `${i + 1}. ${c.line}`).join('\n')}`
  }

  const chosen = candidates[n - 1]
  await focusListing(admin, profile, chosen)
  if (pending && Object.keys(pending).length) return applyPending(chosen.id, pending)
  return openedText({ id: chosen.id, title: chosen.line.replace(/^#\d+\s+/, '') })
}
