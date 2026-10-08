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
import { makeShareToken, shareSecret } from '@/lib/share'

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
export async function handleQueryClient(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const ref = splitClientRef(intent.clientName)
  if (!ref.name) return 'Which client? Try "info on Ahmed".'

  let q = admin
    .from('client_requests')
    .select('*')
    .eq('company_id', profile.company_id)
    .ilike('Client Name', `%${ref.name}%`)
    .limit(6)
  // An area qualifier ("… in Beit Mery") narrows same-named clients.
  if (ref.location) q = q.ilike('prefered-location', `%${ref.location}%`)

  const { data } = await q
  const rows = data ?? []
  if (!rows.length) return `No client matching "${ref.name}"${ref.location ? ` in ${ref.location}` : ''}.`

  const session = toSession(profile)

  if (rows.length > 1) {
    // Show each client's area so identical names are distinguishable, and tell
    // the agent how to pick — "be more specific" is no help when the name is
    // already exact.
    const lines = rows.map(r => {
      const label = canSeeClientPII(session, clientAgent(r)) ? (r['Client Name'] as string) : maskClientName(Number(r.id))
      const area = (r['prefered-location'] as string) || 'no area set'
      return `• ${label} — ${area}`
    })
    const egArea = (rows[0]['prefered-location'] as string) || 'Beirut'
    return `${rows.length} clients match "${ref.name}":\n${lines.join('\n')}\n\nAdd the area to pick one, e.g. "info on ${ref.name} in ${egArea}".`
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
    ...matchLines(matches, origin),
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
  origin: string,
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
    `${origin}/l/${token}`,
    '',
    'Forward this to your client. It shows photos, price and details; owner info stays private.',
  ].join('\n')
}

// Managers can see everything; kept here so Phase 3 handlers can reuse it.
export function describesWholeCompany(profile: Profile): boolean {
  return isManager(profile.role)
}
