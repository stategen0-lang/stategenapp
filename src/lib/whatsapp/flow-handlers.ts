// Phase 5 — driving the multi-step create-property conversation.
//
// State lives in conversation_state (one row per agent), so an agent can answer
// over several messages and still end at the same confirm-before-write step as
// the single-shot path.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CREATE_PROPERTY_STEPS, nextStep, applyAnswer, seedContext,
  progress, derivedTitle, type FlowContext,
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

  const built = buildUpdate(context as Record<string, unknown>, PROPERTY_FIELDS)
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

function ask(context: FlowContext, prefix = ''): string {
  const step = nextStep(context)
  if (!step) return ''
  return `${prefix}${prefix ? '\n\n' : ''}${step.question} ${progress(context)}`
}

/**
 * Begin collecting a listing, pre-filled with whatever the opening message
 * already contained so nothing is asked twice.
 */
export async function startCreatePropertyFlow(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const context = seedContext(intent.fields)
  const step = nextStep(context)

  if (!step) return finish(admin, profile, context)

  await saveFlow(admin, profile, context, step.key)
  const known = Object.keys(context).length
  const opener = known
    ? `Adding a listing — got ${known} detail${known > 1 ? 's' : ''} so far.`
    : "Adding a listing. I'll ask a few questions — reply \"cancel\" to stop."
  return ask(context, opener)
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

  // "help" is what an agent types when they feel stuck, so it must explain the
  // situation rather than being consumed as an answer to the current question.
  if (/^help\b\??$/i.test(body.trim())) {
    const current = nextStep((state.context ?? {}) as FlowContext)
    return [
      "You're part-way through adding a listing.",
      '',
      `Next question: ${current?.question ?? '(none)'}`,
      '',
      'Reply with the answer, or "cancel" to stop adding this listing.',
    ].join('\n')
  }

  const context = (state.context ?? {}) as FlowContext
  const step = nextStep(context)
  if (!step) return finish(admin, profile, context)

  const result = applyAnswer(step, body, context)
  if (result.error) {
    // Re-ask the same question; the context is deliberately unchanged.
    //
    // The escape hatch is repeated on every failure, not just at the start. An
    // agent mid-flow has everything they type read as an answer, so "info on
    // Ahmed" comes back "I didn't recognise that type" — without this line
    // there is no way to discover how to get out.
    return `${result.error}\n\n${step.question} ${progress(context)}`
      + '\n\nOr reply "cancel" to stop adding this listing.'
  }

  const done = nextStep(result.context)
  if (!done) return finish(admin, profile, result.context)

  await saveFlow(admin, profile, result.context, done.key)
  return ask(result.context)
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
