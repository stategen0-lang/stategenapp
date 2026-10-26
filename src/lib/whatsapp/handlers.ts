// Read-only WhatsApp handlers (Phase 2). Write flows follow in Phase 3 behind
// the confirm-before-write rule.
//
// These deliberately reuse the same permission rules as the web app: an agent
// gets full detail on their own clients and masked detail on everyone else's.
// The bot must not become a side door around the masking.

import type { SupabaseClient } from '@supabase/supabase-js'
import { canSeeClientPII, isManager, maskClientName } from '@/lib/permissions'
import { dbRowToClient, dbRowToProperty } from '@/lib/db-mappers'
import { briefFromIntent, searchBrief, describeBrief, matchLines, listingLines, listingPrice } from './match-query.ts'
import { hasBrief, isMatchable } from '@/lib/matching'
import { companyAreaIndex } from '@/lib/lebanon/company-areas-server'
import { formatPrice, propertyLocation, type Property } from '@/lib/data'
import type { IntentResult } from '@/lib/whatsapp/intent'
import { splitClientRef } from '@/lib/whatsapp/client-ref'
import { samePhone } from './phone.ts'
import { makeShareToken, shareSecret, publicOrigin } from '@/lib/share'

export const HELP_TEXT = [
  'I can help with:',
  '• "info on Ahmed" — client details',
  '• "what matches 500k in Beirut" — property search',
  '• "set Ahmed\'s budget to 400k" — update a client',
  '• "mark property #23 as sold" — update a listing',
  '• "find the listing of Khoury" — search listings by owner name/phone, title or area, then edit it',
  '• "move Ahmed to negotiating" — move a deal along the pipeline',
  '• "what\'s in negotiation" — see your pipeline',
  '• "add a listing" — just describe it, I\'ll ask for anything missing',
  '• "add a client" — new buyer/renter, described in your own words',
  '• "template" — the fill-in-the-blanks client form, if you prefer that',
  '• "send me the link for #23" — a shareable listing link',
  '• "photos for #23" — add photos to a listing',
  '• "send #23 to marketing" — email a listing to your marketing team',
  '• "write a description for #23" — an AI listing description',
  '• "spoke to Ahmed, viewing Saturday" — log a call',
  '• "book a viewing tomorrow at 3pm" — add to your calendar',
  '• "what\'s on today" — your schedule',
  '• "help" — this message',
  '',
  'Managers can also ask "how is the team doing" or "what follow-ups are overdue".',
  '',
  'Changes always ask you to reply YES before anything is saved.',
].join('\n')

interface Profile {
  id: string
  company_id: number
  role: string
  agent_code: string | null
  Full_name: string | null
}

/** Session shape the permission helpers expect. */
function toSession(p: Profile) {
  return {
    userId: p.id,
    companyId: p.company_id,
    role: p.role as 'owner' | 'manager' | 'agent',
    agentCode: p.agent_code,
    fullName: p.Full_name ?? 'Agent',
    approved: true,
  }
}

function clientAgent(row: Record<string, unknown>): string | null {
  try { return (JSON.parse((row.notes as string) || '{}').agentId as string) ?? null } catch { return null }
}

// ── "info on Ahmed" ─────────────────────────────────────────────────────────

/**
 * "#41", "client #41", "client 41" — a client picked by number. The way out
 * when two records share a name AND an area ("Joe Khoury — Achrafieh" and
 * "Joe Khoury — Beirut, Achrafieh"), which no name or area can separate.
 */
export function clientNumber(s: string): number | null {
  const m = String(s ?? '').trim().match(/^(?:client\s*)?#\s*(\d{1,7})$|^client\s+(\d{1,7})$/i)
  return m ? Number(m[1] ?? m[2]) : null
}

export async function clientById(admin: SupabaseClient, companyId: number, id: number): Promise<Record<string, unknown>[]> {
  const { data } = await admin.from('client_requests').select('*').eq('company_id', companyId).eq('id', id).limit(1)
  return data ?? []
}

/**
 * A name's consonant skeleton, for matching across transliterations: Lebanese
 * names have no single Latin spelling ("Youssef"/"Yousef"/"Yusuf",
 * "Ziade"/"Ziadeh"/"Ziadé"). Vowels and y dropped, doubles collapsed, a final
 * h dropped. Exported for tests.
 */
export function nameSkeleton(word: string): string {
  return String(word ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '').replace(/h$/, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1')
}

/**
 * Clients whose name matches every word of `name` by skeleton — the fallback
 * when the name as written finds nobody. Live (simulator): "Yousef Ziade",
 * "Youssef Ziadeh" and two more spellings all missed "Youssef ziade".
 */
export async function clientsBySpelling(admin: SupabaseClient, companyId: number, name: string): Promise<Record<string, unknown>[]> {
  const wanted = String(name).split(/\s+/).map(nameSkeleton).filter(s => s.length >= 2)
  if (!wanted.length) return []
  const { data } = await admin.from('client_requests').select('*').eq('company_id', companyId).limit(5000)
  return (data ?? []).filter(r => {
    const have = String(r['Client Name'] ?? '').split(/[\s,]+/).map(nameSkeleton).filter(Boolean)
    return wanted.every(w => have.some(h => h === w))
  }).slice(0, 6)
}

/** "70 123 456", "+961 70123456" — digits and separators only, 7+ digits. */
export function looksLikePhone(s: string): boolean {
  return !/[A-Za-zÀ-ÿ؀-ۿ]/.test(s) && s.replace(/\D/g, '').length >= 7
}

/**
 * Clients whose phone is this number, however either was typed. Phones are
 * stored as written ("70 123 456"), so the database narrows by the last six
 * digits in order and samePhone() decides.
 */
export async function clientsByPhone(admin: SupabaseClient, companyId: number, raw: string): Promise<Record<string, unknown>[]> {
  const tail = raw.replace(/\D/g, '').slice(-6)
  const { data } = await admin
    .from('client_requests')
    .select('*')
    .eq('company_id', companyId)
    .ilike('client phone', `%${tail.split('').join('%')}%`)
    .limit(50)
  return (data ?? []).filter(r => samePhone(r['client phone'] as string, raw)).slice(0, 6)
}

export async function handleQueryClient(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const ref = splitClientRef(intent.clientName)
  if (!ref.name) return 'Which client? Try "info on Ahmed".'

  let rows: Record<string, unknown>[]
  const number = clientNumber(ref.name)
  if (number) {
    rows = await clientById(admin, profile.company_id, number)
  } else if (looksLikePhone(ref.name)) {
    rows = await clientsByPhone(admin, profile.company_id, ref.name)
    // "<phone> in Batroun" — the reply to two clients sharing a number.
    if (ref.location) rows = rows.filter(r => String(r['prefered-location'] ?? '').toLowerCase().includes(ref.location!.toLowerCase()))
  } else {
    let q = admin
      .from('client_requests')
      .select('*')
      .eq('company_id', profile.company_id)
      .ilike('Client Name', `%${ref.name}%`)
      .limit(6)
    // An area qualifier ("… in Beit Mery") narrows same-named clients.
    if (ref.location) q = q.ilike('prefered-location', `%${ref.location}%`)
    const { data } = await q
    rows = data ?? []
    // Nobody under that exact spelling: try the other ways it's written.
    if (!rows.length) {
      rows = await clientsBySpelling(admin, profile.company_id, ref.name)
      if (ref.location) rows = rows.filter(r => String(r['prefered-location'] ?? '').toLowerCase().includes(ref.location!.toLowerCase()))
    }
  }
  if (!rows.length) return `No client matching "${ref.name}"${ref.location ? ` in ${ref.location}` : ''}.`

  const session = toSession(profile)

  if (rows.length > 1) {
    // Show each client's area so identical names are distinguishable, and tell
    // the agent how to pick — "be more specific" is no help when the name is
    // already exact.
    const lines = rows.map(r => {
      // Say why a name is hidden: "Client #23" alone read as a record the bot
      // had failed to load, and it went round in circles trying to open it.
      const label = canSeeClientPII(session, clientAgent(r)) ? `${r['Client Name'] as string} (#${r.id})` : `${maskClientName(Number(r.id))} (another agent's client)`
      const area = (r['prefered-location'] as string) || 'no area set'
      return `• ${label} — ${area}`
    })
    const egArea = (rows[0]['prefered-location'] as string) || 'Beirut'
    return `${rows.length} clients match "${ref.name}":\n${lines.join('\n')}\n\nAdd the area or the number to pick one, e.g. "info on ${ref.name} in ${egArea}" or "info on #${rows[0].id}".`
  }

  const row = rows[0]
  const visible = canSeeClientPII(session, clientAgent(row))
  const c = dbRowToClient(row, 0)

  // The responsible agent's NAME is safe to show (it's a colleague, not client
  // PII) and lets whoever's asking know who to coordinate with.
  const ownerCode = clientAgent(row)
  let ownerName: string | null = null
  if (ownerCode) {
    const { data: ap } = await admin
      .from('Profiles').select('Full_name')
      .eq('company_id', profile.company_id).eq('agent_code', ownerCode).maybeSingle()
    ownerName = (ap?.Full_name as string) ?? null
  }

  // Another agent's client: requirements are useful, contact details are not shared.
  const lines = [
    visible ? c.name : maskClientName(c.id),
    visible && c.phone ? `Phone: ${c.phone}` : null,
    `Type: ${c.type}`,
    `Budget: ${formatPrice(c.budget)}`,
    c.req.location ? `Wants: ${c.req.location}` : null,
    c.req.type ? `Property type: ${c.req.type}` : null,
    c.req.beds ? `Bedrooms: ${c.req.beds}` : null,
    c.req.baths ? `Bathrooms: ${c.req.baths}` : null,
    c.req.parkings ? `Parking: ${c.req.parkings}` : null,
    // The rest of the request — "send me X's request" means all of it.
    c.req.size ? `Min size: ${c.req.size} m²` : null,
    c.req.furnishing ? `Furnishing: ${c.req.furnishing}` : null,
    c.req.view ? `View: ${c.req.view}` : null,
    c.req.floor ? `Floor: ${c.req.floor}` : null,
    [c.req.garden && 'garden', c.req.balcony && 'balcony', c.req.terrace && 'terrace'].filter(Boolean).length
      ? `Outdoor: ${[c.req.garden && 'garden', c.req.balcony && 'balcony', c.req.terrace && 'terrace'].filter(Boolean).join(', ')}` : null,
    [...(c.req.amenities ?? []), ...(c.req.buildingFeatures ?? [])].length
      ? `Must-haves: ${[...(c.req.amenities ?? []), ...(c.req.buildingFeatures ?? [])].join(', ')}` : null,
    // Free text can hold contact details, so only for a client they may see.
    visible && c.req.notes?.trim() ? `Notes: ${c.req.notes.trim()}` : null,
    `Status: ${c.status}`,
    row.lead_score != null ? `Lead score: ${row.lead_score}/100` : null,
    ownerName ? `Agent: ${ownerName}` : null,
    visible ? null : '(Another agent\'s client — contact details hidden)',
  ].filter(Boolean)

  return lines.join('\n')
}

// ── "what matches 500k in Beirut" ───────────────────────────────────────────
export async function handleQueryProperty(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
  origin = '',
): Promise<string> {
  const { data } = await admin
    .from('Properties')
    .select('*')
    .eq('company_id', profile.company_id)

  const properties = (data ?? []).map((r, i) => dbRowToProperty(r, i))
  if (!properties.length) return 'There are no listings yet.'

  // A specific listing by id: "property #23"
  if (intent.propertyId) {
    const p = properties.find(x => x.id === intent.propertyId)
    if (!p) return `No listing with id #${intent.propertyId}.`
    return [
      `#${p.id} ${p.title}`,
      `${p.type} · ${p.transaction}`,
      listingPrice(p),
      propertyLocation(p),
      p.beds ? `${p.beds} bed · ${p.baths} bath · ${p.size} m²` : `${p.size} m²`,
      `Status: ${p.status}`,
    ].join('\n')
  }

  // The brief the agent actually described — areas, type, rent or sale, beds,
  // must-haves — not just a budget. See match-query.ts for why that matters.
  const brief = briefFromIntent(intent)
  const areas = await companyAreaIndex(admin, profile.company_id).catch(() => null)

  // Nothing to narrow by: the matcher would call every listing a 100% match, so
  // show the newest instead and say what would help.
  if (!hasBrief(brief)) {
    const available = properties.filter(isMatchable).slice(0, 5)
    return [
      `${properties.length} listings. Most recent:`,
      ...available.map(p => listingLines(p, origin)),
      '',
      'Tell me a budget, an area or a type to narrow it down — e.g. "2 bed apartment to rent in Jounieh under 800".',
    ].join('\n')
  }

  // "130 sqm apartments": a size is a range, not a floor — ±10%, so 130 also
  // finds 120 and 140. Without this the agent model opened listings one by one
  // to read their sizes (7s) and listed 60 to 220 m².
  const sizeAround = Number((intent.fields as Record<string, unknown> | undefined)?.sizeAround) || 0
  if (sizeAround > 0) return sizeSearch(brief, properties, areas, sizeAround, origin)

  const matches = searchBrief(brief, properties, areas).slice(0, 5)
  const wanted = describeBrief(brief)

  if (!matches.length) {
    return [
      `Nothing matches ${wanted}.`,
      '',
      'The matcher keeps to the right type and deal, within ±30% of budget and 4 km of the area. Widen one of those and I will look again.',
    ].join('\n')
  }

  return [
    `${matches.length} match${matches.length > 1 ? 'es' : ''} for ${wanted}:`,
    ...matchLines(matches, origin, brief.budget),
  ].join('\n')
}

/** Listings around a size (±10%), ranked by the matcher; the nearest sizes when none fit. */
function sizeSearch(
  brief: ReturnType<typeof briefFromIntent>,
  properties: Property[],
  areas: Awaited<ReturnType<typeof companyAreaIndex>> | null,
  size: number,
  origin: string,
): string {
  const lo = Math.round(size * 0.9), hi = Math.round(size * 1.1)
  // With nothing else to go on, every available listing is a candidate.
  const pool = hasBrief(brief)
    ? searchBrief(brief, properties, areas)
    : properties.filter(isMatchable).map(property => ({ property, score: { total: 0 } }) as ReturnType<typeof searchBrief>[number])
  const wanted = hasBrief(brief) ? describeBrief(brief) : 'listings'
  const inBand = pool.filter(m => m.property.size >= lo && m.property.size <= hi)
  if (inBand.length) {
    return [
      `${inBand.length} ${wanted} between ${lo} and ${hi} m²:`,
      ...matchLines(inBand.slice(0, 8), origin, brief.budget),
    ].join('\n')
  }
  const nearest = pool.filter(m => m.property.size > 0)
    .sort((a, b) => Math.abs(a.property.size - size) - Math.abs(b.property.size - size))
    .slice(0, 5)
  if (!nearest.length) return `Nothing matches ${wanted} around ${size} m².`
  return [
    `No ${wanted} between ${lo} and ${hi} m². Nearest sizes:`,
    ...matchLines(nearest, origin, brief.budget),
  ].join('\n')
}

// ── "send me the link for #23" ──────────────────────────────────────────────
// Mints a public, unguessable share link for a listing — the same token the web
// app's Share button produces — so an agent can forward it to a client straight
// from WhatsApp. The link only shows client-safe fields; owner name/contact and
// internal notes never reach the public page (see src/lib/share.ts).
export async function handleShareListing(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  if (!intent.propertyId) return 'Which listing? Try "send me the link for #23".'

  const { data } = await admin
    .from('Properties')
    .select('*')
    .eq('company_id', profile.company_id)
    .eq('id', intent.propertyId)
    .maybeSingle()

  if (!data) return `No listing with id #${intent.propertyId}.`

  const p = dbRowToProperty(data, 0)
  const token = makeShareToken(p.id, shareSecret())
  const price = p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)
  return [
    `${p.title} — ${price}`,
    `${publicOrigin()}/l/${token}`,
    '',
    'Forward this to your client. It shows photos, price and details; owner info stays private.',
  ].join('\n')
}

// Managers can see everything; kept here so Phase 3 handlers can reuse it.
export function describesWholeCompany(profile: Profile): boolean {
  return isManager(profile.role)
}
