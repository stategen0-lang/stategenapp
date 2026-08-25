// Multi-step "add a listing" / "add a client" flows.
//
// State lives in conversation_state (one row per agent). Both flows share one
// form engine (flows.ts) and one confirm-before-write step; they differ only in
// their field set and how the finished record is written. A small registry
// keyed by the flow name keeps continueFlow from caring which is which.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CREATE_PROPERTY_STEPS, CREATE_CLIENT_STEPS, LISTING_INTRO, CLIENT_INTRO,
  seedContext, seedForm, renderForm, parseForm, missingMandatory,
  derivedTitle, answersOf, extrasOf, type FlowStep, type FlowContext,
} from '@/lib/whatsapp/flows'
import { buildUpdate, confirmationText, PROPERTY_FIELDS, PROPERTY_TYPES } from '@/lib/whatsapp/writes'
import { stage, type Profile } from '@/lib/whatsapp/write-handlers'
import type { IntentResult } from '@/lib/whatsapp/intent'
import type { BotReply } from '@/lib/whatsapp/cloud'

type FlowName = 'create_property' | 'create_client'

interface FlowConfig {
  steps: FlowStep[]
  intro: string
  noun: string   // "listing" / "client", for the cancel/help copy
  finish: (admin: SupabaseClient, profile: Profile, context: FlowContext) => Promise<string>
}

async function clearFlow(admin: SupabaseClient, profileId: string) {
  await admin.from('conversation_state').delete().eq('profile_id', profileId)
}

async function saveFlow(admin: SupabaseClient, profile: Profile, flow: FlowName, context: FlowContext, step = 'form') {
  await admin.from('conversation_state').upsert({
    company_id: profile.company_id,
    profile_id: profile.id,
    current_flow: flow,
    step,
    context,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' })
}

// The fields we ask by tapping instead of typing, in order, before the fill-in
// form. Binary choices are buttons; the property type is a list (≤10 rows). Each
// value still lives in the same step/context, so the rest of the flow (the form,
// confirm-before-write) is unchanged.
interface ChoicePrompt {
  key: string
  text: string
  buttons?: { id: string; title: string }[]
  list?: { button: string; rows: { id: string; title: string }[] }
}
const typeRows = PROPERTY_TYPES.map(t => ({ id: t.toLowerCase(), title: t }))
const CHOICES: Record<FlowName, ChoicePrompt[]> = {
  create_client: [
    { key: 'clientType',   text: 'Adding a client — buyer or renter?', buttons: [{ id: 'buyer', title: 'Buyer' }, { id: 'renter', title: 'Renter' }] },
    { key: 'propertyType', text: 'What are they looking for?', list: { button: 'Choose type', rows: typeRows } },
  ],
  create_property: [
    { key: 'transaction', text: 'Adding a listing — for sale or for rent?', buttons: [{ id: 'sale', title: 'For Sale' }, { id: 'rent', title: 'For Rent' }] },
    { key: 'type',        text: 'What type of property?', list: { button: 'Choose type', rows: typeRows } },
  ],
}

function toReply(c: ChoicePrompt): BotReply {
  return c.buttons ? { text: c.text, buttons: c.buttons } : { text: c.text, list: c.list! }
}

/** The first choice whose value isn't in context yet, or null once all are answered. */
function nextChoice(flow: FlowName, ctx: FlowContext): ChoicePrompt | null {
  return CHOICES[flow].find(c => ctx[c.key] == null || ctx[c.key] === '') ?? null
}

// ── Finishing each flow: stage a confirm-before-write ─────────────────────────

async function finishProperty(admin: SupabaseClient, profile: Profile, context: FlowContext): Promise<string> {
  await clearFlow(admin, profile.id)

  const built = buildUpdate({ ...answersOf(context), ...extrasOf(context) }, PROPERTY_FIELDS)
  const columns: Record<string, unknown> = { ...built.columns, company_id: profile.company_id }
  if (!columns.Title) columns.Title = derivedTitle(context)

  const extras = { ...built.extras }
  if (profile.agent_code) extras.agentId = profile.agent_code

  const changes = [`Title: ${columns.Title}`, ...built.changes]
  return stage(admin, profile, 'create_property', confirmationText('a new listing', changes), {
    table: 'Properties', columns, extras, blobColumn: 'Amenities', label: String(columns.Title),
  })
}

async function finishClient(admin: SupabaseClient, profile: Profile, context: FlowContext): Promise<string> {
  await clearFlow(admin, profile.id)

  const clientType = String(context.clientType)              // Buyer | Renter
  const transaction = clientType === 'Renter' ? 'For Rent' : 'For Sale'
  const budget = Number(context.budget) || 0

  // Columns mirror what the web form writes; the single budget goes in both
  // budget_min and budget_max so nothing reads a stale bound.
  const columns: Record<string, unknown> = {
    company_id: profile.company_id,
    'Client Name': context.name,
    'client phone': context.phone,
    'prefered-location': context.location,
    budget_min: budget,
    budget_max: budget,
    payment_terms: transaction,
    bedrooms: context.beds ?? null,
    status: 'Searching',
  }
  // The app reads these from the notes JSON blob (see db-mappers): the buyer/
  // renter type, the owning agent, and what they're after — wanted property type
  // and the bed/bath/parking requirement (bedrooms also gets its own column).
  const req: Record<string, unknown> = { type: context.propertyType }
  if (context.beds != null) req.beds = context.beds
  if (context.baths != null) req.baths = context.baths
  if (context.parkings != null) req.parkings = context.parkings
  const extras: Record<string, unknown> = {
    type: clientType,
    agentId: profile.agent_code ?? undefined,
    req,
  }

  const changes = [
    `Name: ${context.name}`,
    `Phone: ${context.phone}`,
    `${clientType} · wants ${context.propertyType} in ${context.location}`,
    `Budget: $${budget.toLocaleString('en-US')}`,
    context.beds ? `Bedrooms: ${context.beds}` : null,
    context.baths ? `Bathrooms: ${context.baths}` : null,
    context.parkings ? `Parking: ${context.parkings}` : null,
  ].filter(Boolean) as string[]

  return stage(admin, profile, 'create_client', confirmationText('a new client', changes), {
    table: 'client_requests', columns, extras, blobColumn: 'notes', label: String(context.name),
  })
}

const FLOWS: Record<FlowName, FlowConfig> = {
  create_property: { steps: CREATE_PROPERTY_STEPS, intro: LISTING_INTRO, noun: 'listing', finish: finishProperty },
  create_client:   { steps: CREATE_CLIENT_STEPS,   intro: CLIENT_INTRO,  noun: 'client',  finish: finishClient },
}

// ── Starting each flow ────────────────────────────────────────────────────────

async function start(
  admin: SupabaseClient, profile: Profile, flow: FlowName, context: FlowContext,
): Promise<BotReply> {
  const cfg = FLOWS[flow]
  // If the opening message already gave everything required, skip to confirm.
  if (missingMandatory(context, cfg.steps).length === 0) return cfg.finish(admin, profile, context)

  // Ask the tap-choices (buyer/renter or sale/rent, then property type) first —
  // skipping any the opening message already gave us (e.g. "add a buyer").
  const next = nextChoice(flow, context)
  if (next) {
    await saveFlow(admin, profile, flow, context, 'await_choice')
    return toReply(next)
  }

  await saveFlow(admin, profile, flow, context)
  return renderForm(cfg.intro, cfg.steps, context)
}

export function startCreatePropertyFlow(admin: SupabaseClient, profile: Profile, intent: IntentResult): Promise<BotReply> {
  return start(admin, profile, 'create_property', seedContext(intent.fields))
}

export function startCreateClientFlow(admin: SupabaseClient, profile: Profile, intent: IntentResult): Promise<BotReply> {
  return start(admin, profile, 'create_client', seedForm(intent.fields, CREATE_CLIENT_STEPS))
}

// ── Continuing whichever flow is open ─────────────────────────────────────────

export async function continueFlow(
  admin: SupabaseClient, profile: Profile, body: string,
): Promise<BotReply | null> {
  const { data: state } = await admin
    .from('conversation_state')
    .select('current_flow, step, context, updated_at')
    .eq('profile_id', profile.id)
    .maybeSingle()

  if (!state) return null
  const flow = state.current_flow as FlowName | undefined
  if (!flow || !FLOWS[flow]) return null
  const cfg = FLOWS[flow]

  // A flow left open for a day is almost certainly forgotten.
  if (state.updated_at && Date.now() - new Date(state.updated_at).getTime() > 24 * 3600_000) {
    await clearFlow(admin, profile.id)
    return null
  }

  // "cancel" (not "stop" — a bare STOP is the global opt-out handled upstream)
  // aborts the flow. The prompts tell the agent to reply "cancel", so this stays
  // in step with them.
  if (/^(cancel|abort|nevermind|never mind|quit)\b/i.test(body.trim())) {
    await clearFlow(admin, profile.id)
    return `Cancelled — the ${cfg.noun} was not saved.`
  }

  const prev = (state.context ?? {}) as FlowContext

  // Waiting on a tap-choice (buyer/renter, sale/rent, or the property type list).
  // Accept the tap (its title arrives as the body) OR a typed value; then move on
  // to the next unanswered choice, the form, or — if nothing's left — the confirm.
  if (state.step === 'await_choice') {
    const pending = nextChoice(flow, prev)
    let ctx = prev
    if (pending) {
      const field = cfg.steps.find(s => s.key === pending.key)!
      const val = field.coerce(body)
      if (val != null && val !== '') {
        ctx = { ...prev, [pending.key]: val }
      } else {
        const parsed = parseForm(body, cfg.steps, prev).context   // maybe they typed instead of tapping
        if (parsed[pending.key] != null && parsed[pending.key] !== '') ctx = parsed
        else return toReply(pending)   // couldn't read it → re-ask this choice
      }
    }
    const next = nextChoice(flow, ctx)
    if (next) { await saveFlow(admin, profile, flow, ctx, 'await_choice'); return toReply(next) }
    if (missingMandatory(ctx, cfg.steps).length === 0) return cfg.finish(admin, profile, ctx)
    await saveFlow(admin, profile, flow, ctx)
    return renderForm(cfg.intro, cfg.steps, ctx)
  }

  if (/^help\b\??$/i.test(body.trim())) {
    const missing = missingMandatory(prev, cfg.steps).map(s => s.label)
    return [
      `You're part-way through adding a ${cfg.noun}.`,
      missing.length ? `Still required: ${missing.join(', ')}.` : 'All required fields are in — send the form back to save.',
      '',
      'Fill in the form and send it back, or reply "cancel" to stop.',
    ].join('\n')
  }

  const { context, invalid } = parseForm(body, cfg.steps, prev)
  const missing = missingMandatory(context, cfg.steps)

  if (invalid.length || missing.length) {
    await saveFlow(admin, profile, flow, context)
    const problems: string[] = []
    if (invalid.length) problems.push(`Couldn't read: ${invalid.join(', ')}.`)
    if (missing.length) problems.push(`Still need: ${missing.map(s => s.label).join(', ')}.`)
    return `${problems.join(' ')}\n\n${renderForm(cfg.intro, cfg.steps, context)}\n\nOr reply "cancel" to stop.`
  }

  return cfg.finish(admin, profile, context)
}
