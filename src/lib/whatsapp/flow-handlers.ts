// Phase 5 — driving the multi-step create-property conversation.
//
// State lives in conversation_state (one row per agent), so an agent can answer
// over several messages and still end at the same confirm-before-write step as
// the single-shot path.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  seedContext, listingForm, parseListingForm, missingMandatory,
  derivedTitle, answersOf, extrasOf, type FlowContext,
} from '@/lib/whatsapp/flows'
import { buildUpdate, confirmationText, PROPERTY_FIELDS } from '@/lib/whatsapp/writes'
import { stage, type Profile } from '@/lib/whatsapp/write-handlers'
import type { IntentResult } from '@/lib/whatsapp/intent'

const FLOW = 'create_property'

/** Abandon a half-finished flow rather than leaving it to ambush a later message. */
async function clearFlow(admin: SupabaseClient, profileId: string) {
  await admin.from('conversation_state').delete().eq('profile_id', profileId)
}

async function saveFlow(admin: SupabaseClient, profile: Profile, context: FlowContext, step: string) {
  await admin.from('conversation_state').upsert({
    company_id: profile.company_id,
    profile_id: profile.id,
    current_flow: FLOW,
    step,
    context,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' })
}

/** Everything collected — hand off to the normal confirmation step. */
async function finish(admin: SupabaseClient, profile: Profile, context: FlowContext): Promise<string> {
  await clearFlow(admin, profile.id)

  // Answered questions plus anything the agent volunteered up front that the
  // flow never asked about (bathrooms, size, parking).
  const built = buildUpdate({ ...answersOf(context), ...extrasOf(context) }, PROPERTY_FIELDS)
  const columns: Record<string, unknown> = { ...built.columns, company_id: profile.company_id }
  if (!columns.Title) columns.Title = derivedTitle(context)

  const extras = { ...built.extras }
  if (profile.agent_code) extras.agentId = profile.agent_code

  const changes = [`Title: ${columns.Title}`, ...built.changes]
  return stage(admin, profile, 'create_property', confirmationText('a new listing', changes), {
    table: 'Properties',
    columns,
    extras,
    blobColumn: 'Amenities',
    label: String(columns.Title),
  })
}

/**
 * Begin a listing. The agent gets the whole form at once (not one question at a
 * time), pre-filled with anything the opening message already contained. If
 * they gave everything mandatory up front, skip straight to the confirmation.
 */
export async function startCreatePropertyFlow(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const context = seedContext(intent.fields)
  if (missingMandatory(context).length === 0) return finish(admin, profile, context)

  await saveFlow(admin, profile, context, 'form')
  return listingForm(context)
}

/**
 * Continue an in-progress flow. Returns null when the agent has none, so the
 * webhook falls through to normal intent classification.
 */
export async function continueFlow(
  admin: SupabaseClient,
  profile: Profile,
  body: string,
): Promise<string | null> {
  const { data: state } = await admin
    .from('conversation_state')
    .select('current_flow, step, context, updated_at')
    .eq('profile_id', profile.id)
    .maybeSingle()

  if (!state || state.current_flow !== FLOW) return null

  // A flow left open for a day is almost certainly forgotten; treat it as stale
  // rather than resuming it under a message about something else entirely.
  if (state.updated_at && Date.now() - new Date(state.updated_at).getTime() > 24 * 3600_000) {
    await clearFlow(admin, profile.id)
    return null
  }

  if (/^(cancel|stop|abort|nevermind|never mind|quit)\b/i.test(body.trim())) {
    await clearFlow(admin, profile.id)
    return 'Cancelled — the listing was not saved.'
  }

  const prev = (state.context ?? {}) as FlowContext

  // "help" explains the situation rather than being read as form input.
  if (/^help\b\??$/i.test(body.trim())) {
    const missing = missingMandatory(prev).map(s => s.label)
    return [
      "You're part-way through adding a listing.",
      missing.length ? `Still required: ${missing.join(', ')}.` : 'All required fields are in — send the form back to save.',
      '',
      'Fill in the form and send it back, or reply "cancel" to stop.',
    ].join('\n')
  }

  // Merge whatever this reply supplied into what we already had.
  const { context, invalid } = parseListingForm(body, prev)
  const missing = missingMandatory(context)

  if (invalid.length || missing.length) {
    await saveFlow(admin, profile, context, 'form')
    const problems: string[] = []
    if (invalid.length) problems.push(`Couldn't read: ${invalid.join(', ')}.`)
    if (missing.length) problems.push(`Still need: ${missing.map(s => s.label).join(', ')}.`)
    return `${problems.join(' ')}\n\n${listingForm(context)}\n\nOr reply "cancel" to stop.`
  }

  return finish(admin, profile, context)
}

/** Is this agent mid-flow? Used to decide message routing. */
export async function hasActiveFlow(admin: SupabaseClient, profileId: string): Promise<boolean> {
  const { data } = await admin
    .from('conversation_state')
    .select('current_flow')
    .eq('profile_id', profileId)
    .maybeSingle()
  return !!data?.current_flow
}
