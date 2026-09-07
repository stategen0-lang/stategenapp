// Multi-step "add a listing" / "add a client" flows.
//
// State lives in conversation_state (one row per agent). Both flows share one
// form engine (flows.ts) and one confirm-before-write step; they differ only in
// their field set and how the finished record is written. A small registry
// keyed by the flow name keeps continueFlow from caring which is which.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CREATE_PROPERTY_STEPS, CREATE_CLIENT_STEPS,
  seedContext, seedForm, missingMandatory, firstMissing, nextQuestion,
  derivedTitle, answersOf, extrasOf, EXTRA_KEY, isStartListing, isStartClient,
  type FlowStep, type FlowContext,
} from '@/lib/whatsapp/flows'
import { extractCreateFields } from '@/lib/whatsapp/flow-extract'
import { buildUpdate, confirmationText, PROPERTY_FIELDS } from '@/lib/whatsapp/writes'
import { stage, type Profile } from '@/lib/whatsapp/write-handlers'
import type { IntentResult } from '@/lib/whatsapp/intent'
import type { BotReply } from '@/lib/whatsapp/cloud'
import { isManager } from '@/lib/permissions'

type FlowName = 'create_property' | 'create_client'

interface FlowConfig {
  steps: FlowStep[]
  noun: string   // "listing" / "client", for the cancel/help copy
  finish: (admin: SupabaseClient, profile: Profile, context: FlowContext) => Promise<string>
}

// Merge fields the agent just volunteered (AI-extracted from a free-text reply)
// onto the running context, reusing the same seeders the opening message uses.
function mergeExtracted(flow: FlowName, prev: FlowContext, fields: Record<string, unknown>): FlowContext {
  if (!Object.keys(fields).length) return prev
  if (flow === 'create_client') return { ...prev, ...seedForm(fields, CREATE_CLIENT_STEPS) }
  const seeded = seedContext(fields)   // property: answers + an __extra bag
  const extra = { ...extrasOf(prev), ...extrasOf(seeded) }
  const merged: FlowContext = { ...prev, ...answersOf(seeded) }
  if (Object.keys(extra).length) merged[EXTRA_KEY] = extra
  return merged
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
  // A manager assigns the client to a chosen agent (__ownerAgent, set by the
  // pick-list step); an agent adding their own client owns it themselves.
  const extras: Record<string, unknown> = {
    type: clientType,
    agentId: (context.__ownerAgent as string | undefined) ?? profile.agent_code ?? undefined,
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
    context.__ownerAgentName ? `Assigned to: ${context.__ownerAgentName}` : null,
  ].filter(Boolean) as string[]

  return stage(admin, profile, 'create_client', confirmationText('a new client', changes), {
    table: 'client_requests', columns, extras, blobColumn: 'notes', label: String(context.name),
  })
}

const FLOWS: Record<FlowName, FlowConfig> = {
  create_property: { steps: CREATE_PROPERTY_STEPS, noun: 'listing', finish: finishProperty },
  create_client:   { steps: CREATE_CLIENT_STEPS,   noun: 'client',  finish: finishClient },
}

const INTRO: Record<FlowName, string> = {
  create_property: "Let's add a listing.",
  create_client: "Let's add a client.",
}

// ── Manager assigns the client to an agent (the call-center case) ──────────────

interface AgentChoice { code: string; name: string }

// Every colleague who can own a client — anyone with an agent_code (agents, and
// an owner-manager who has one). Mirrors /api/company/agents.
async function listCompanyAgents(admin: SupabaseClient, companyId: number): Promise<AgentChoice[]> {
  const { data } = await admin
    .from('Profiles')
    .select('agent_code, Full_name')
    .eq('company_id', companyId)
    .not('agent_code', 'is', null)
    .order('Full_name')
  return (data ?? [])
    .filter(p => p.agent_code)
    .map(p => ({ code: p.agent_code as string, name: (p.Full_name as string) || (p.agent_code as string) }))
}

function agentPickList(agents: AgentChoice[]): string {
  const lines = agents.map((a, i) => `${i + 1}. ${a.name}`).join('\n')
  return `Who's the responsible agent for this client?\n\n${lines}\n\nReply with the number.`
}

/**
 * The finish gate. A manager (call-center) adding a client must first say which
 * agent owns it — we pause on a numbered pick-list. Everyone else (an agent
 * adding their own client, any listing) goes straight to confirm-before-write.
 */
async function finishOrPickAgent(
  admin: SupabaseClient, profile: Profile, flow: FlowName, context: FlowContext,
): Promise<string> {
  if (flow === 'create_client' && isManager(profile.role) && !context.__ownerAgent) {
    const agents = await listCompanyAgents(admin, profile.company_id)
    if (agents.length) {
      await saveFlow(admin, profile, flow, { ...context, __agentChoices: agents }, 'await_agent')
      return agentPickList(agents)
    }
    // No agents to assign to — fall through and let the write proceed unassigned.
  }
  return FLOWS[flow].finish(admin, profile, context)
}

// ── Starting each flow ────────────────────────────────────────────────────────

// Native WhatsApp Flow forms — a pop-up with fields + a Submit button. Enabled
// per flow via env (the Flow's ID from WhatsApp Manager). Until it's published
// and the ID is set, the bot falls back to the copy-paste text form. The Flow's
// screen id must be 'FORM' and its complete-action payload must carry
// "__flow":"<flow name>" and the step keys, matching the JSON we publish.
const FLOW_FORM: Record<FlowName, { envId: string; cta: string; body: string }> = {
  create_property: { envId: 'WHATSAPP_FLOW_LISTING', cta: 'Add listing', body: '📋 Tap to add a listing — fill the form and submit.' },
  create_client:   { envId: 'WHATSAPP_FLOW_CLIENT',  cta: 'Add client',  body: '📋 Tap to add a client — fill the form and submit.' },
}
const FLOW_SCREEN = 'FORM'

async function start(
  admin: SupabaseClient, profile: Profile, flow: FlowName, context: FlowContext,
): Promise<BotReply> {
  const cfg = FLOWS[flow]
  // If the opening message already gave everything required, skip to confirm
  // (a manager is asked to pick the owning agent first).
  if (missingMandatory(context, cfg.steps).length === 0) return finishOrPickAgent(admin, profile, flow, context)

  // Prefer the native Flow form when its ID is configured (dormant until then).
  const form = FLOW_FORM[flow]
  const flowId = process.env[form.envId]
  if (flowId) {
    // No conversation_state: the submission returns as a Flow reply (handled by
    // handleFlowSubmission), not as continueFlow text.
    await clearFlow(admin, profile.id)
    return { flow: { flowId, flowToken: flow, cta: form.cta, body: form.body, screen: FLOW_SCREEN } }
  }

  // Conversational default: ask the first missing field in plain language, and
  // remember which field we asked so the next reply is read as its answer.
  const asked = firstMissing(context, cfg.steps)!
  const ctx: FlowContext = { ...context, __asked: asked.key }
  await saveFlow(admin, profile, flow, ctx)
  const gotSome = Object.keys(context).some(k => k !== EXTRA_KEY)
  const ack = gotSome ? `${INTRO[flow]} Got a few details already —` : INTRO[flow]
  return nextQuestion(ctx, cfg.steps, ack)
}

/**
 * A submitted WhatsApp Flow form: coerce its fields into a flow context and run
 * the same finish (confirm-before-write) as the text form. The payload carries a
 * "__flow" discriminator so we know which record to build.
 */
export async function handleFlowSubmission(
  admin: SupabaseClient, profile: Profile, data: Record<string, unknown>,
): Promise<string> {
  const flow = String(data.__flow ?? '') as FlowName
  const cfg = FLOWS[flow]
  if (!cfg) return "Sorry, I couldn't read that form. Please try again."
  await clearFlow(admin, profile.id)

  const context: FlowContext = {}
  for (const step of cfg.steps) {
    const raw = data[step.key]
    if (raw == null || raw === '') continue
    const value = step.coerce(raw)
    if (value != null) context[step.key] = value
  }

  const missing = missingMandatory(context, cfg.steps)
  if (missing.length) {
    return `The form is missing: ${missing.map(s => s.label).join(', ')}. Send "add a ${cfg.noun}" and try again.`
  }
  return finishOrPickAgent(admin, profile, flow, context)
}

export function startCreatePropertyFlow(admin: SupabaseClient, profile: Profile, intent: IntentResult) {
  return start(admin, profile, 'create_property', seedContext(intent.fields))
}

export function startCreateClientFlow(admin: SupabaseClient, profile: Profile, intent: IntentResult) {
  return start(admin, profile, 'create_client', seedForm(intent.fields, CREATE_CLIENT_STEPS))
}

// ── Continuing whichever flow is open ─────────────────────────────────────────

// Requests that should pull the agent OUT of a half-finished create flow rather
// than being read as a field answer. Kept to clear command/query phrasings that
// a listing/client field value would never look like (a value is "villa",
// "450k", "Joe Khoury" — never "show me…" or "book a meeting…").
const BREAKS_FLOW = /^(show me\b|info on\b|who ?is\b|who'?s\b|what'?s (on|new|in)\b|whats (on|new)\b|what matches\b|my schedule\b|send me\b|write (a )?descri|book\s+(a|an)?\s*(viewing|meeting|call|appointment)|schedule\s+(a|an)?\s*(viewing|meeting|call)|remind me to\b|move \S+ to\b|mark \S+ (as|sold|rented)\b|offers? on\b|help\s*\??$)/i
function breaksFlow(body: string): boolean {
  const s = body.trim()
  return isStartListing(s) || isStartClient(s) || BREAKS_FLOW.test(s)
}

export async function continueFlow(
  admin: SupabaseClient, profile: Profile, body: string,
): Promise<string | null> {
  const { data: state } = await admin
    .from('conversation_state')
    .select('current_flow, context, updated_at, step')
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
  if (/^(cancel|abort|nevermind|never mind|quit|stop it)\b/i.test(body.trim())) {
    await clearFlow(admin, profile.id)
    return `Cancelled — the ${cfg.noun} was not saved.`
  }

  // Escape hatch: a clearly different request abandons a half-finished flow (so
  // an unanswered "add a listing" doesn't swallow every later message). Clear it
  // and return null so the webhook reprocesses the message from scratch.
  if (breaksFlow(body)) {
    await clearFlow(admin, profile.id)
    return null
  }

  const prev = (state.context ?? {}) as FlowContext

  // Manager picking the owning agent from the numbered list.
  if (state.step === 'await_agent') {
    const choices = (prev.__agentChoices ?? []) as AgentChoice[]
    const n = parseInt(body.trim(), 10)
    if (!Number.isInteger(n) || n < 1 || n > choices.length) {
      return `Please reply with a number between 1 and ${choices.length}.\n\n${agentPickList(choices)}`
    }
    const picked = choices[n - 1]
    const ctx: FlowContext = { ...prev, __ownerAgent: picked.code, __ownerAgentName: picked.name }
    delete ctx.__agentChoices
    return cfg.finish(admin, profile, ctx)
  }

  if (/^help\b\??$/i.test(body.trim())) {
    const missing = missingMandatory(prev, cfg.steps).map(s => s.label)
    return [
      `We're adding a ${cfg.noun} together — just tell me the details in your own words.`,
      missing.length ? `Still need: ${missing.join(', ')}.` : 'That\'s everything — reply "yes" to save.',
      'Or reply "cancel" to stop.',
    ].join('\n')
  }

  // Read the reply as natural language: pull whatever fields it mentions, then
  // fall back to coercing the raw reply as the specific field we just asked for.
  const askedKey = typeof prev.__asked === 'string' ? prev.__asked : undefined
  const askedStep = askedKey ? cfg.steps.find(s => s.key === askedKey) : undefined

  const extracted = await extractCreateFields(flow, body, askedStep?.label)
  let context = mergeExtracted(flow, prev, extracted)

  const stillEmpty = (k: string) => context[k] === undefined || context[k] === null || context[k] === ''
  if (askedStep && stillEmpty(askedStep.key)) {
    const v = askedStep.coerce(body)
    if (v !== null && v !== undefined) context = { ...context, [askedStep.key]: v }
  }

  const beforeMissing = missingMandatory(prev, cfg.steps).length
  const missing = missingMandatory(context, cfg.steps)

  if (missing.length === 0) {
    delete context.__asked
    return finishOrPickAgent(admin, profile, flow, context)
  }

  // Something is still missing — ask the next field. Acknowledge progress, or own
  // it when we couldn't read the last answer (then we re-ask the same field).
  const advanced = missing.length < beforeMissing || Boolean(askedStep && !stillEmpty(askedStep.key))
  context.__asked = missing[0].key
  await saveFlow(admin, profile, flow, context)
  const ack = advanced ? 'Got it.' : "Sorry, I didn't catch that."
  return nextQuestion(context, cfg.steps, ack)
}
