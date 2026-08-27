// Offers & negotiation over WhatsApp.
//
//   "offer 450k from Joe on #23"   → log a buyer offer
//   "counter Joe 470k"             → log an owner counter
//   "accept Joe's offer"           → close the deal WON at the current amount
//   "reject the offer on #23"      → reject the current offer
//   "offers on #23" / "status #23" → read where the negotiation stands
//
// Writes go through the same confirm-before-write step as every other change.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isManager } from '@/lib/permissions'
import { stage, resolveClient, type Profile } from '@/lib/whatsapp/write-handlers'
import { confirmationText } from '@/lib/whatsapp/writes'
import type { IntentResult } from '@/lib/whatsapp/intent'
import { money, sideLabel, negotiationLine, type OfferSide } from '@/lib/offers'
import { fetchPropertyNegotiations } from '@/lib/offers-server'

type Row = Record<string, unknown>

type DealCtx =
  | { ok: false; message: string }
  | { ok: true; dealId: string; name: string; propertyId: number | null; propTitle: string }

// Resolve the client's deal (deals are backfilled per client), enforce
// ownership, and settle which property the offer is on.
async function dealFor(admin: SupabaseClient, profile: Profile, intent: IntentResult, needProperty: boolean): Promise<DealCtx> {
  const found = await resolveClient(admin, profile, intent.clientName)
  if (!found.ok) return { ok: false, message: found.message }
  const client = found.row
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

  const propertyId = intent.propertyId ?? ((deal.property_id as number | null) ?? null)
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

function offerAmount(intent: IntentResult): number {
  const raw = intent.fields?.amount ?? intent.budget
  return Number(raw) || 0
}

// ── "offer 450k from Joe on #23" / "counter Joe 470k" ────────────────────────
export async function stageLogOffer(admin: SupabaseClient, profile: Profile, intent: IntentResult): Promise<string> {
  const amount = offerAmount(intent)
  if (amount <= 0) return 'How much is the offer? e.g. "offer 450k from Joe on #23".'
  const side: OfferSide = String(intent.fields?.side ?? 'buyer') === 'owner' ? 'owner' : 'buyer'

  const d = await dealFor(admin, profile, intent, true)
  if (!d.ok) return d.message

  const changes = [
    `${sideLabel(side)} ${side === 'owner' ? 'counter' : 'offer'}: ${money(amount)}`,
    `On ${d.propTitle}`,
    `Deal: ${d.name}`,
  ]
  return stage(admin, profile, 'log_offer', confirmationText('a new offer', changes), {
    table: 'offers',
    columns: { dealId: d.dealId, amount, side, propertyId: d.propertyId, note: intent.notes ?? null },
    extras: {}, label: d.propTitle,
  })
}

// ── "accept Joe's offer" / "reject the offer on #23" ─────────────────────────
export async function stageResolveOffer(admin: SupabaseClient, profile: Profile, intent: IntentResult, decision: 'accept' | 'reject'): Promise<string> {
  let dealId: string, name: string, propTitle: string

  if (intent.clientName) {
    const d = await dealFor(admin, profile, intent, false)
    if (!d.ok) return d.message
    dealId = d.dealId; name = d.name; propTitle = d.propTitle
  } else if (intent.propertyId) {
    // No client named — resolve the single open negotiation on the listing.
    const scopeCode = isManager(profile.role) ? null : profile.agent_code
    const negs = await fetchPropertyNegotiations(admin, { companyId: profile.company_id, propertyId: intent.propertyId, agentCode: scopeCode })
    const open = negs.filter(n => n.state.status === 'open')
    if (!open.length) return `No open offer on #${intent.propertyId} to ${decision}.`
    if (open.length > 1) return `#${intent.propertyId} has open offers from ${open.map(n => n.clientName).join(', ')}. Say which, e.g. "${decision} ${open[0].clientName}'s offer".`
    dealId = open[0].dealId; name = open[0].clientName; propTitle = `#${intent.propertyId}`
  } else {
    return `Which offer? e.g. "${decision} Joe's offer" or "${decision} the offer on #23".`
  }

  const verb = decision === 'accept' ? 'Accept' : 'Reject'
  const changes = [`Deal: ${name}`, ...(propTitle ? [`On ${propTitle}`] : [])]
  if (decision === 'accept') changes.push('Deal will close as WON at the current offer.')
  return stage(admin, profile, decision === 'accept' ? 'accept_offer' : 'reject_offer',
    confirmationText(`${verb} the current offer`, changes),
    { table: 'offers', columns: { dealId }, extras: {}, label: propTitle || `${name}'s deal` })
}

// ── "offers on #23" / "status on #23" ────────────────────────────────────────
export async function handleQueryOffers(admin: SupabaseClient, profile: Profile, intent: IntentResult): Promise<string> {
  const scopeCode = isManager(profile.role) ? null : profile.agent_code

  if (!intent.propertyId) {
    // No listing named — try the client they mentioned.
    if (!intent.clientName) return 'Which listing? e.g. "offers on #23".'
    const d = await dealFor(admin, profile, intent, false)
    if (!d.ok) return d.message
    if (!d.propertyId) return `${d.name} has no offers logged yet.`
    const negs = await fetchPropertyNegotiations(admin, { companyId: profile.company_id, propertyId: d.propertyId, agentCode: scopeCode })
    const mine = negs.find(n => n.dealId === d.dealId)
    return mine ? `💬 ${d.name} — ${d.propTitle}\n${negotiationLine(mine.state)}` : `No offers logged for ${d.name} yet.`
  }

  const { data: prop } = await admin
    .from('Properties').select('Title, Price').eq('id', intent.propertyId).eq('company_id', profile.company_id).maybeSingle()
  const asking = prop ? (Number(prop.Price) || null) : null
  const negs = await fetchPropertyNegotiations(admin, { companyId: profile.company_id, propertyId: intent.propertyId, agentCode: scopeCode })
  if (!negs.length) return `No offers logged on #${intent.propertyId} yet.`

  const header = `💬 Offers on #${intent.propertyId}${prop?.Title ? ` ${prop.Title}` : ''}`
  const lines = negs.map(n => `• ${n.clientName}: ${negotiationLine(n.state, { asking })}`)
  return [header, '', ...lines].join('\n')
}
