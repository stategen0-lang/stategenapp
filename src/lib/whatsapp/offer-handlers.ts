// Offers & negotiation over WhatsApp.
//
//   "offer 450k from Joe on #23"   → log a buyer offer
//   "counter Joe 470k"             → log an owner counter
//   "accept Joe's offer"           → close the deal WON at the current amount
//   "reject the offer on #23"      → reject the current offer
//   "offers on #23" / "status #23" → read where the negotiation stands
//
// When a name matches several clients, we save a numbered pick (with the offer
// it belongs to) so the reply "2" continues the offer instead of being re-read
// as a fresh message. Writes go through the same confirm-before-write step.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isManager } from '@/lib/permissions'
import { stage, resolveClient, clientLabel, type Profile } from '@/lib/whatsapp/write-handlers'
import { confirmationText } from '@/lib/whatsapp/writes'
import type { IntentResult } from '@/lib/whatsapp/intent'
import { money, sideLabel, negotiationLine, type OfferSide } from '@/lib/offers'
import { fetchPropertyNegotiations } from '@/lib/offers-server'

type Row = Record<string, unknown>

interface Resume {
  kind: 'log_offer' | 'accept_offer' | 'reject_offer' | 'query_offers'
  amount?: number
  side?: OfferSide
  propertyId?: number | null
  note?: string | null
}

function offerAmount(intent: IntentResult): number {
  return Number(intent.fields?.amount ?? intent.budget) || 0
}

type DealCtx =
  | { ok: false; message: string }
  | { ok: true; dealId: string; name: string; propertyId: number | null; propTitle: string }

// Resolve a KNOWN client's deal (deals are backfilled per client), enforce
// ownership, and settle which property the offer is on.
async function dealForClient(admin: SupabaseClient, profile: Profile, client: Row, needProperty: boolean, propertyIdIn: number | null): Promise<DealCtx> {
  const name = client['Client Name'] as string
  const { data: deals } = await admin
    .from('deals').select('id, agent_id, stage, property_id')
    .eq('company_id', profile.company_id).eq('client_id', Number(client.id))
    .order('created_at', { ascending: false })
  const deal = (deals ?? [])[0] as Row | undefined
  if (!deal) return { ok: false, message: `${name} has no deal in the pipeline yet.` }
  if (!isManager(profile.role) && deal.agent_id !== profile.agent_code) {
    return { ok: false, message: `${name}'s deal belongs to another agent, so I can't touch it.` }
  }
  const propertyId = propertyIdIn ?? ((deal.property_id as number | null) ?? null)
  if (needProperty && !propertyId) {
    return { ok: false, message: `Which listing is this offer on? Include its number, e.g. "offer 450k from ${name.split(' ')[0]} on #23".` }
  }
  let propTitle = propertyId ? `#${propertyId}` : ''
  if (propertyId) {
    const { data: prop } = await admin.from('Properties').select('Title').eq('id', propertyId).eq('company_id', profile.company_id).maybeSingle()
    if (prop?.Title) propTitle = `#${propertyId} ${prop.Title}`
  }
  return { ok: true, dealId: deal.id as string, name, propertyId, propTitle }
}

// ── Cores: act on a resolved client ──────────────────────────────────────────

async function logOfferForClient(admin: SupabaseClient, profile: Profile, client: Row, r: Resume): Promise<string> {
  const amount = Number(r.amount) || 0
  if (amount <= 0) return 'How much is the offer? e.g. "offer 450k from Joe on #23".'
  const side: OfferSide = r.side === 'owner' ? 'owner' : 'buyer'
  const d = await dealForClient(admin, profile, client, true, r.propertyId ?? null)
  if (!d.ok) return d.message
  const changes = [
    `${sideLabel(side)} ${side === 'owner' ? 'counter' : 'offer'}: ${money(amount)}`,
    `On ${d.propTitle}`, `Deal: ${d.name}`,
  ]
  return stage(admin, profile, 'log_offer', confirmationText('a new offer', changes), {
    table: 'offers', columns: { dealId: d.dealId, amount, side, propertyId: d.propertyId, note: r.note ?? null }, extras: {}, label: d.propTitle,
  })
}

async function resolveOfferForClient(admin: SupabaseClient, profile: Profile, client: Row, decision: 'accept' | 'reject'): Promise<string> {
  const d = await dealForClient(admin, profile, client, false, null)
  if (!d.ok) return d.message
  const verb = decision === 'accept' ? 'Accept' : 'Reject'
  const changes = [`Deal: ${d.name}`, ...(d.propTitle ? [`On ${d.propTitle}`] : [])]
  if (decision === 'accept') changes.push('Deal will close as WON at the current offer.')
  return stage(admin, profile, decision === 'accept' ? 'accept_offer' : 'reject_offer',
    confirmationText(`${verb} the current offer`, changes),
    { table: 'offers', columns: { dealId: d.dealId }, extras: {}, label: d.propTitle || `${d.name}'s deal` })
}

async function queryOffersForClient(admin: SupabaseClient, profile: Profile, client: Row): Promise<string> {
  const d = await dealForClient(admin, profile, client, false, null)
  if (!d.ok) return d.message
  if (!d.propertyId) return `${d.name} has no offers logged yet.`
  const scopeCode = isManager(profile.role) ? null : profile.agent_code
  const negs = await fetchPropertyNegotiations(admin, { companyId: profile.company_id, propertyId: d.propertyId, agentCode: scopeCode })
  const mine = negs.find(n => n.dealId === d.dealId)
  return mine ? `💬 ${d.name} — ${d.propTitle}\n${negotiationLine(mine.state)}` : `No offers logged for ${d.name} yet.`
}

// ── Numbered pick when a name is ambiguous ───────────────────────────────────

interface Candidate { id: number; label: string; area: string }

async function savePick(admin: SupabaseClient, profile: Profile, rows: Row[], resume: Resume): Promise<string> {
  const candidates: Candidate[] = rows.map(r => ({
    id: Number(r.id), label: clientLabel(profile, r), area: (r['prefered-location'] as string) || 'no area set',
  }))
  await admin.from('conversation_state').upsert({
    company_id: profile.company_id, profile_id: profile.id,
    current_flow: 'pick_client', step: 'await_pick',
    context: { candidates, resume }, updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' })
  const lines = candidates.map((c, i) => `${i + 1}. ${c.label} — ${c.area}`).join('\n')
  return `Which one?\n\n${lines}\n\nReply with the number.`
}

// Handle the numeric reply to a pending "which client?" pick. Returns null when
// there is no pick open (so the webhook falls through to normal handling).
export async function continueOfferPick(admin: SupabaseClient, profile: Profile, body: string): Promise<string | null> {
  const { data: state } = await admin
    .from('conversation_state').select('current_flow, context, updated_at').eq('profile_id', profile.id).maybeSingle()
  if (!state || state.current_flow !== 'pick_client') return null

  const clear = () => admin.from('conversation_state').delete().eq('profile_id', profile.id)
  if (state.updated_at && Date.now() - new Date(state.updated_at).getTime() > 24 * 3600_000) { await clear(); return null }

  const ctx = (state.context ?? {}) as { candidates?: Candidate[]; resume?: Resume }
  const candidates = ctx.candidates ?? []
  const t = body.trim()
  if (/^(cancel|abort|nevermind|never mind|quit)\b/i.test(t)) { await clear(); return 'Okay, cancelled.' }

  const n = parseInt(t, 10)
  if (!Number.isInteger(n) || n < 1 || n > candidates.length) {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.label} — ${c.area}`).join('\n')
    return `Please reply with a number between 1 and ${candidates.length}.\n\n${lines}`
  }

  const chosen = candidates[n - 1]
  await clear()
  const { data: client } = await admin.from('client_requests').select('*').eq('id', chosen.id).eq('company_id', profile.company_id).maybeSingle()
  if (!client) return 'That client record no longer exists.'

  const r = ctx.resume ?? { kind: 'query_offers' as const }
  switch (r.kind) {
    case 'log_offer':    return logOfferForClient(admin, profile, client as Row, r)
    case 'accept_offer': return resolveOfferForClient(admin, profile, client as Row, 'accept')
    case 'reject_offer': return resolveOfferForClient(admin, profile, client as Row, 'reject')
    default:             return queryOffersForClient(admin, profile, client as Row)
  }
}

// ── Intent entry points ──────────────────────────────────────────────────────

export async function stageLogOffer(admin: SupabaseClient, profile: Profile, intent: IntentResult): Promise<string> {
  const amount = offerAmount(intent)
  if (amount <= 0) return 'How much is the offer? e.g. "offer 450k from Joe on #23".'
  const side: OfferSide = String(intent.fields?.side ?? 'buyer') === 'owner' ? 'owner' : 'buyer'
  const resume: Resume = { kind: 'log_offer', amount, side, propertyId: intent.propertyId ?? null, note: intent.notes ?? null }

  const found = await resolveClient(admin, profile, intent.clientName)
  if (found.ok) return logOfferForClient(admin, profile, found.row, resume)
  if (found.candidates && found.candidates.length > 1) return savePick(admin, profile, found.candidates, resume)
  // No client named at all → offer-specific guidance (an offer is logged against
  // a client's deal, so we need who + which listing), echoing the amount we read.
  if (!intent.clientName) {
    const amt = amount >= 1_000_000 ? `${amount / 1_000_000}m` : amount >= 1000 ? `${Math.round(amount / 1000)}k` : String(amount)
    return `Got a ${amt} offer. Who made it, and on which listing? Reply like: "offer ${amt} from Sara on #23".`
  }
  return found.message
}

export async function stageResolveOffer(admin: SupabaseClient, profile: Profile, intent: IntentResult, decision: 'accept' | 'reject'): Promise<string> {
  if (intent.clientName) {
    const found = await resolveClient(admin, profile, intent.clientName)
    if (found.ok) return resolveOfferForClient(admin, profile, found.row, decision)
    if (found.candidates && found.candidates.length > 1) {
      return savePick(admin, profile, found.candidates, { kind: decision === 'accept' ? 'accept_offer' : 'reject_offer' })
    }
    return found.message
  }

  if (intent.propertyId) {
    // No client named — resolve the single open negotiation on the listing.
    const scopeCode = isManager(profile.role) ? null : profile.agent_code
    const negs = await fetchPropertyNegotiations(admin, { companyId: profile.company_id, propertyId: intent.propertyId, agentCode: scopeCode })
    const open = negs.filter(n => n.state.status === 'open')
    if (!open.length) return `No open offer on #${intent.propertyId} to ${decision}.`
    if (open.length > 1) return `#${intent.propertyId} has open offers from ${open.map(n => n.clientName).join(', ')}. Say which, e.g. "${decision} ${open[0].clientName}'s offer".`
    const verb = decision === 'accept' ? 'Accept' : 'Reject'
    const changes = [`Deal: ${open[0].clientName}`, `On #${intent.propertyId}`]
    if (decision === 'accept') changes.push('Deal will close as WON at the current offer.')
    return stage(admin, profile, decision === 'accept' ? 'accept_offer' : 'reject_offer',
      confirmationText(`${verb} the current offer`, changes),
      { table: 'offers', columns: { dealId: open[0].dealId }, extras: {}, label: `#${intent.propertyId}` })
  }

  return `Which offer? e.g. "${decision} Joe's offer" or "${decision} the offer on #23".`
}

export async function handleQueryOffers(admin: SupabaseClient, profile: Profile, intent: IntentResult): Promise<string> {
  if (intent.propertyId) {
    const scopeCode = isManager(profile.role) ? null : profile.agent_code
    const { data: prop } = await admin
      .from('Properties').select('Title, Price').eq('id', intent.propertyId).eq('company_id', profile.company_id).maybeSingle()
    const asking = prop ? (Number(prop.Price) || null) : null
    const negs = await fetchPropertyNegotiations(admin, { companyId: profile.company_id, propertyId: intent.propertyId, agentCode: scopeCode })
    if (!negs.length) return `No offers logged on #${intent.propertyId} yet.`
    const header = `💬 Offers on #${intent.propertyId}${prop?.Title ? ` ${prop.Title}` : ''}`
    return [header, '', ...negs.map(n => `• ${n.clientName}: ${negotiationLine(n.state, { asking })}`)].join('\n')
  }

  if (intent.clientName) {
    const found = await resolveClient(admin, profile, intent.clientName)
    if (found.ok) return queryOffersForClient(admin, profile, found.row)
    if (found.candidates && found.candidates.length > 1) return savePick(admin, profile, found.candidates, { kind: 'query_offers' })
    return found.message
  }

  return 'Which listing? e.g. "offers on #23".'
}
