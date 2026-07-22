// Read-only WhatsApp handlers (Phase 2). Write flows follow in Phase 3 behind
// the confirm-before-write rule.
//
// These deliberately reuse the same permission rules as the web app: an agent
// gets full detail on their own clients and masked detail on everyone else's.
// The bot must not become a side door around the masking.

import type { SupabaseClient } from '@supabase/supabase-js'
import { canSeeClientPII, isManager, maskClientName } from '@/lib/permissions'
import { dbRowToClient, dbRowToProperty } from '@/lib/db-mappers'
import { matchProperties } from '@/lib/matching'
import { formatPrice } from '@/lib/data'
import type { IntentResult } from '@/lib/whatsapp/intent'

export const HELP_TEXT = [
  'I can help with:',
  '• "info on Ahmed" — client details',
  '• "what matches 500k in Beirut" — property search',
  '• "set Ahmed\'s budget to 400k" — update a client',
  '• "mark property #23 as sold" — update a listing',
  '• "add listing: 3 bed in Hamra, Beirut, 450k" — new listing',
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
  const name = intent.clientName
  if (!name) return 'Which client? Try "info on Ahmed".'

  const { data } = await admin
    .from('client_requests')
    .select('*')
    .eq('company_id', profile.company_id)
    .ilike('Client Name', `%${name}%`)
    .limit(5)

  const rows = data ?? []
  if (!rows.length) return `No client matching "${name}".`

  const session = toSession(profile)

  if (rows.length > 1) {
    const names = rows.map(r =>
      canSeeClientPII(session, clientAgent(r)) ? (r['Client Name'] as string) : maskClientName(Number(r.id)),
    )
    return `${rows.length} clients match "${name}":\n${names.map(n => `• ${n}`).join('\n')}\n\nBe more specific.`
  }

  const row = rows[0]
  const visible = canSeeClientPII(session, clientAgent(row))
  const c = dbRowToClient(row, 0)

  // Another agent's client: requirements are useful, contact details are not shared.
  const lines = [
    visible ? c.name : maskClientName(c.id),
    visible && c.phone ? `Phone: ${c.phone}` : null,
    `Type: ${c.type}`,
    `Budget: ${formatPrice(c.budget)}`,
    c.req.location ? `Wants: ${c.req.location}` : null,
    c.req.type ? `Property type: ${c.req.type}` : null,
    c.req.beds ? `Bedrooms: ${c.req.beds}` : null,
    `Status: ${c.status}`,
    row.lead_score != null ? `Lead score: ${row.lead_score}/100` : null,
    visible ? null : '(Another agent\'s client — contact details hidden)',
  ].filter(Boolean)

  return lines.join('\n')
}

// ── "what matches 500k in Beirut" ───────────────────────────────────────────
export async function handleQueryProperty(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
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
      `${p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}`,
      `${p.district}, ${p.city}`,
      p.beds ? `${p.beds} bed · ${p.baths} bath · ${p.size} m²` : `${p.size} m²`,
      `Status: ${p.status}`,
    ].join('\n')
  }

  // Otherwise run the real matching engine, so WhatsApp and the app agree.
  if (!intent.budget && !intent.location) {
    const available = properties.filter(p => p.status !== 'Sold').slice(0, 5)
    return [
      `${properties.length} listings. Most recent:`,
      ...available.map(p => `• #${p.id} ${p.title} — ${p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)}`),
      '',
      'Add a budget or area to narrow it down, e.g. "what matches 500k in Beirut".',
    ].join('\n')
  }

  const criteria = {
    budget: intent.budget ?? 0,
    type: 'Buyer' as const,
    req: {
      transaction: '' as const,
      type: '' as const,
      location: intent.location ?? '',
      priceMin: 0,
      priceMax: intent.budget ?? 0,
      beds: 0, baths: 0, size: 0,
      garden: false, balcony: false, notes: '',
    },
  }

  const matches = matchProperties(criteria, properties).slice(0, 5)
  if (!matches.length) {
    const what = [intent.budget ? formatPrice(intent.budget) : null, intent.location].filter(Boolean).join(' in ')
    return `Nothing matches ${what}.\n\nThe matcher only suggests listings within ±50% of budget and in the same or a neighbouring area.`
  }

  const header = `${matches.length} match${matches.length > 1 ? 'es' : ''} for ${[intent.budget ? formatPrice(intent.budget) : null, intent.location].filter(Boolean).join(' in ')}:`
  return [
    header,
    ...matches.map(({ property: p, score }) =>
      `• #${p.id} ${p.title} — ${p.transaction === 'For Rent' ? `${formatPrice(p.rent)}/mo` : formatPrice(p.price)} · ${p.district} · ${Math.round(score.total)}% match`),
  ].join('\n')
}

// Managers can see everything; kept here so Phase 3 handlers can reuse it.
export function describesWholeCompany(profile: Profile): boolean {
  return isManager(profile.role)
}
