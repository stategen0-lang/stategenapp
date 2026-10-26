// The bot's routing: given one message from a connected agent, decide the
// reply. Shared by the webhook (which receives from and sends to WhatsApp) and
// scripts/agent-sim.mjs (which runs the same decisions against an in-memory
// copy of an agency, so conversations can be tested end to end without
// WhatsApp or touching real data). Delivery, logging, pairing and opt-out stay
// in the webhook.

import type { BotReply } from '@/lib/whatsapp/cloud'
import { parseConfirmation, parseBareConfirmation, parseReminderReply, parseBareReminderReply } from '@/lib/whatsapp/replies'
import { classifyIntent, type Intent } from '@/lib/whatsapp/intent'
import { handleQueryClient, handleQueryProperty, handleShareListing, HELP_TEXT } from '@/lib/whatsapp/handlers'
import {
  stageClientUpdate, stagePropertyUpdate, stageFeedback, stageDescribeProperty, stageArabicDescription,
  applyPendingAction, handleReminderReply,
} from '@/lib/whatsapp/write-handlers'
import { startCreatePropertyFlow, startCreateClientFlow, startClientFormFlow, continueFlow } from '@/lib/whatsapp/flow-handlers'
import { stageDealMove, handleQueryPipeline } from '@/lib/whatsapp/pipeline-handlers'
import { startKind, isClientForm, isTemplateRequest, CLIENT_TEMPLATE } from '@/lib/whatsapp/flows'
import { handleAgentActivity, handleOverdueReminders, handleActivityFeed } from '@/lib/whatsapp/manager-handlers'
import { stageLogOffer, stageResolveOffer, handleQueryOffers, continueOfferPick } from '@/lib/whatsapp/offer-handlers'
import { parseMarketingRequest, isMarketingRequestWithoutId } from '@/lib/whatsapp/marketing-intent'
import { requestMarketing } from '@/lib/whatsapp/marketing-handlers'
import { stageCreateEvent, continueEventFlow, handleQuerySchedule } from '@/lib/whatsapp/calendar-handlers'
import { findListings, continueListingPick, focusedListing, focusListing, queryFromIntent } from '@/lib/whatsapp/listing-finder'
import { hasCriteria } from '@/lib/listing-search-core'
import type { IntentResult } from '@/lib/whatsapp/intent'
import type { SupabaseClient } from '@supabase/supabase-js'
import { agentReady, answerWithAgent, type AgentFallback } from '@/lib/whatsapp/agent'
import { describeError } from '@/lib/whatsapp/agent/loop'
import { queueOf } from '@/lib/whatsapp/agent/tools'
import { replyText } from '@/lib/whatsapp/cloud'

/**
 * After a "yes", prepare the next change the agent queued with it — the agent
 * never has to ask again. Whatever remains rides on the change prepared now,
 * so each approval brings up the next.
 */
async function prepareQueued(
  admin: SupabaseClient, profile: Profile, origin: string,
  meta: { phone: string; inboundLogId: string | null }, queued: string[], saved: string,
): Promise<string> {
  let answer: string | AgentFallback
  try {
    answer = await answerWithAgent({
      admin, profile, origin, phone: meta.phone, inboundLogId: meta.inboundLogId,
      // Not the agent's words — a note from the system, written so the model
      // neither re-confirms (it's saved) nor re-queues (the rest is handled).
      // Names what was saved: "the change above" read, to the model, as the
      // card it had just shown, and it warned that card had been "replaced".
      body: `[System: the agent replied YES and this is now saved: "${saved.split('\n')[0]}". Nothing is waiting any more — don't confirm, re-check or mention it. Prepare only the next change they asked for, now, with the right tool, and don't queue anything: ${queued[0]}]`,
      legacy: async instruction => (await routeByIntent(admin, profile, instruction, origin, { forAgent: true })).answer,
    })
  } catch {
    answer = { fallback: 'crash' }
  }
  if (typeof answer !== 'string') return `Next you asked for: ${queued[0]} — send it again and I'll prepare it.`
  const rest = queued.slice(1)
  if (rest.length) {
    const { data: next } = await admin
      .from('pending_actions').select('id, payload')
      .eq('profile_id', profile.id).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (next) await admin.from('pending_actions').update({ payload: { ...(next.payload as Record<string, unknown>), next: rest } }).eq('id', next.id)
    // Nothing prepared (a listing not found…): say what's still to do rather
    // than drop it.
    else return `${answer}\n\nStill to do after that: ${rest.join('; ')}. Send them again when you're ready.`
  }
  return answer
}

// The agent's bridge must not start the old step-by-step create flows.
const USE_AGENT_CREATE_TOOL = 'Adding clients and listings has its own tools (create_client / create_listing) — use those instead.'

// A yes/no with nothing staged. The old wording ("send the change again") was
// a dead end for the case that actually happens: the agent saying "no, not
// that one" because something was already saved to the wrong record. Say what
// to do next instead.
const NOTHING_PENDING =
  'Nothing is waiting for confirmation — it expired, or the change was already saved. ' +
  'If something went in wrong, just send the correction, e.g. "remind me tomorrow to call Ahmad".'

export interface Profile {
  id: string
  company_id: number
  role: string
  agent_code: string | null
  Full_name: string | null
  whatsapp_number: string | null
  whatsapp_enabled: boolean | null
}

/**
 * Resolve which listing a request is about when it has no #number: the words
 * that identify it ("Khoury's flat in Kaslik"), else the listing the agent
 * opened last. One search match runs the action on it; several give a
 * numbered list (carrying an update's change, so the pick applies it).
 */
async function withListing(
  admin: SupabaseClient, profile: Profile, result: IntentResult,
  run: (r: IntentResult) => Promise<string>, isUpdate = false,
): Promise<string> {
  if (result.propertyId) {
    const answer = await run(result)
    // A listing acted on by number becomes the current one, for follow-ups.
    await focusListing(admin, profile, { id: result.propertyId, title: `#${result.propertyId}` })
    return answer
  }

  // For an update, the fields are the CHANGE, not search filters — search only
  // by the identifying words and area.
  const query = isUpdate ? { text: result.search, location: result.location } : queryFromIntent(result)
  if (hasCriteria(query)) {
    const changes = isUpdate && result.fields && Object.keys(result.fields).length ? result.fields : undefined
    const found = await findListings(admin, profile, query, changes)
    if (found.resolvedId) return withListing(admin, profile, { ...result, propertyId: found.resolvedId }, run, isUpdate)
    return found.reply
  }

  const focus = await focusedListing(admin, profile)
  if (focus) return run({ ...result, propertyId: focus.id })
  return run(result)   // the handler's own "which listing?" prompt
}

/**
 * Decide the reply. Split out from POST so each branch simply returns, rather
 * than assigning into a variable that later branches could still overwrite.
 *
 * Order matters, and the handlers must stay inline: several of them write to
 * the database, so hoisting one into a const above the branches applies it even
 * when a different branch ends up answering. That bug shipped briefly in Phase 4.
 */
export type Routed = { intent: Intent | 'confirm_pending' | 'send_marketing' | 'agent' | `agent_fallback${string}`; answer: BotReply }

export async function route(
  admin: SupabaseClient,
  profile: Profile,
  body: string,
  origin: string,
  meta: { phone: string; inboundLogId: string | null },
): Promise<Routed> {
  // A write waiting on "yes" outranks anything a model might infer.
  const { data: pending } = await admin
    .from('pending_actions')
    .select('id, action_type, summary, payload, expires_at')
    .eq('profile_id', profile.id)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // With the agent on, only a message that is nothing but a yes or a no is
  // decided here. "yes but she's a renter" goes to the agent, which prepares
  // the corrected change — under the first-word rule it saved her as a buyer.
  const agentOn = agentReady(profile.company_id)
  const confirmation = agentOn ? parseBareConfirmation(body) : parseConfirmation(body)

  if (pending && confirmation !== 'unknown') {
    // Consume the action first, whichever way it goes: a pending write must
    // never be applicable twice.
    await admin.from('pending_actions').delete().eq('id', pending.id)
    // Changes the agent asked for in the same breath, queued behind this one.
    const queued = queueOf(pending.payload)
    if (confirmation === 'confirm') {
      const saved = await applyPendingAction(admin, profile, pending.action_type, pending.payload)
      if (!queued.length || !agentOn) return { intent: 'confirm_pending', answer: saved }
      return { intent: 'confirm_pending', answer: `${replyText(saved)}\n\n${await prepareQueued(admin, profile, origin, meta, queued, replyText(saved))}` }
    }
    const declined = pending.action_type === 'send_marketing'
      ? `OK, not sent. Send "send #${(pending.payload as { id?: number } | null)?.id ?? '…'} to marketing" any time.`
      : 'Cancelled — nothing was saved.'
    // A no to this one isn't a no to the rest — ask rather than assume.
    return {
      intent: 'confirm_pending',
      answer: queued.length ? `${declined}\n\nYou also asked me to: ${queued[0]}. Still want that? Say yes and I'll prepare it.` : declined,
    }
  }

  // ── The conversational agent ──────────────────────────────────────────────
  // Everything below this point in the old router is a hand-written rule for
  // remembering what the agent was in the middle of — a "which listing?" pick,
  // a half-filled form, an event waiting on a time. The agent holds the
  // conversation itself, so for an agency that has it switched on it takes
  // over from here. The yes/no above stays deterministic: a "yes" commits a
  // staged change without the model being involved at all.
  if (agentOn) {
    // Replies to an outstanding follow-up reminder ("done", "snooze 3d") keep
    // their own handler: it fires only while a reminder is outstanding and
    // returns null otherwise.
    const reminder = parseBareReminderReply(body)
    if (reminder.action !== 'unknown') {
      const reminderAnswer = await handleReminderReply(admin, profile, reminder.action, reminder.snoozeDays, body)
      if (reminderAnswer !== null) return { intent: 'reminder_response', answer: reminderAnswer }
    }
    let agentAnswer: string | AgentFallback
    try {
      agentAnswer = await answerWithAgent({
        admin, profile, body, origin,
        phone: meta.phone,
        inboundLogId: meta.inboundLogId,
        legacy: async instruction => (await routeByIntent(admin, profile, instruction, origin, { forAgent: true })).answer,
      })
    } catch (err) {
      // Anything unexpected in the agent itself (loading history, a bug) is
      // treated like Claude being unavailable: the old router still answers.
      console.error('[whatsapp-agent] failed — the old router answers instead', err)
      agentAnswer = { fallback: `crash: ${describeError(err)}` }
    }
    if (typeof agentAnswer === 'string') return { intent: 'agent', answer: agentAnswer }

    // Claude couldn't be reached before anything happened — a bad key, an
    // outage. The old router answers instead, so the agent gets a reply rather
    // than "something went wrong". The reason goes into whatsapp_logs with the
    // intent, so it can be read from the database, not only the server logs.
    const legacy = await routeContinuations(admin, profile, body, origin, confirmation)
    return { intent: `agent_fallback: ${agentAnswer.fallback}`, answer: legacy.answer }
  }

  return routeContinuations(admin, profile, body, origin, confirmation)
}

/**
 * The old router's rules for remembering what the agent was in the middle of,
 * then classification. What answers when the agent is off — and when it's on
 * but Claude can't be reached.
 */
async function routeContinuations(
  admin: SupabaseClient,
  profile: Profile,
  body: string,
  origin: string,
  confirmation: ReturnType<typeof parseConfirmation>,
): Promise<Routed> {
  // A reply to "which listing?" — opens that listing, and applies the change the
  // agent asked for if the request carried one ("mark Khoury's flat as sold").
  const listingPick = await continueListingPick(admin, profile, body,
    (propertyId, fields) => stagePropertyUpdate(admin, profile, { intent: 'update_property', propertyId, fields }))
  if (listingPick !== null) return { intent: 'find_listing', answer: listingPick }

  // A pending "which client?" pick (e.g. mid-offer) — a numeric reply picks the
  // client and continues the offer, rather than being re-read as a new message.
  const pickAnswer = await continueOfferPick(admin, profile, body)
  if (pickAnswer !== null) return { intent: 'log_offer', answer: pickAnswer }

  // Mid-flow, per the spec's router: an agent answering "Villa" to "what type?"
  // must not have that re-read as a fresh intent.
  const flowAnswer = await continueFlow(admin, profile, body)
  if (flowAnswer !== null) return { intent: 'create_property', answer: flowAnswer }

  // An event waiting on a time: the agent's "tomorrow at 3pm" reply completes the
  // booking rather than being read as a brand-new message.
  const eventAnswer = await continueEventFlow(admin, profile, body)
  if (eventAnswer !== null) return { intent: 'create_event', answer: eventAnswer }

  // The client brief template: handing it out, and reading a filled-in one back.
  // Both are answered here rather than by the model — the labels say exactly
  // what each value is, so classifying it would only add latency and risk.
  if (isTemplateRequest(body)) return { intent: 'create_client', answer: CLIENT_TEMPLATE }

  // "send #45 to marketing" — staged, then sent on YES.
  const marketingId = parseMarketingRequest(body)
  if (marketingId) return { intent: 'send_marketing', answer: await requestMarketing(admin, profile, marketingId, origin) }
  if (isMarketingRequestWithoutId(body)) {
    // "send it to marketing" — the listing the agent opened.
    const focus = await focusedListing(admin, profile)
    return {
      intent: 'send_marketing',
      answer: focus
        ? await requestMarketing(admin, profile, focus.id, origin)
        : 'Which listing? Send "send #23 to marketing", or find it first — e.g. "find the listing of Khoury".',
    }
  }

  if (isClientForm(body)) {
    return { intent: 'create_client', answer: await startClientFormFlow(admin, profile, body) }
  }

  // "done" / "snooze 3d" / "not interested" only mean what they appear to while
  // a reminder is outstanding; otherwise this returns null and the message
  // falls through to normal classification.
  const reminderReply = parseReminderReply(body)
  if (reminderReply.action !== 'unknown') {
    const reminderAnswer = await handleReminderReply(admin, profile, reminderReply.action, reminderReply.snoozeDays, body)
    if (reminderAnswer !== null) return { intent: 'reminder_response', answer: reminderAnswer }
  }

  if (confirmation !== 'unknown') {
    // A yes/no with nothing staged. Answering this locally matters: sending it
    // to the model returns "I didn't understand", which reads as though the
    // change might still be pending when in fact nothing is.
    return {
      intent: confirmation,
      answer: NOTHING_PENDING,
    }
  }

  return routeByIntent(admin, profile, body, origin)
}

/**
 * Classify one message and run the matching handler. The old router's core,
 * and the bridge the agent uses (forAgent) for requests it has no native tool
 * for yet — pipeline moves, offers, bookings, marketing.
 */
async function routeByIntent(
  admin: SupabaseClient,
  profile: Profile,
  body: string,
  origin: string,
  opts: { forAgent?: boolean } = {},
): Promise<Routed> {
  const result = await classifyIntent(body)

  // The model is still asked, so any details in the message are extracted and the
  // flow can skip questions — but the routing decision is ours when the wording
  // is unambiguous.
  const kind = startKind(body)
  const intent = kind === 'listing' ? 'create_property'
    : kind === 'client' ? 'create_client'
    : result.intent

  switch (intent) {
    case 'query_client':   return { intent, answer: await handleQueryClient(admin, profile, result) }
    case 'query_property': return { intent, answer: await handleQueryProperty(admin, profile, result, origin) }
    case 'find_listing':   return { intent, answer: (await findListings(admin, profile, queryFromIntent(result))).reply }
    case 'share_listing':  return { intent, answer: await withListing(admin, profile, result, r => handleShareListing(admin, profile, r)) }
    case 'describe_property': return { intent, answer: await withListing(admin, profile, result, r => stageDescribeProperty(admin, profile, r)) }
    case 'describe_property_ar': return { intent, answer: await withListing(admin, profile, result, r => stageArabicDescription(admin, profile, r)) }
    case 'log_offer':      return { intent, answer: await stageLogOffer(admin, profile, result) }
    case 'query_offers':   return { intent, answer: await handleQueryOffers(admin, profile, result) }
    case 'accept_offer':   return { intent, answer: await stageResolveOffer(admin, profile, result, 'accept') }
    case 'reject_offer':   return { intent, answer: await stageResolveOffer(admin, profile, result, 'reject') }
    case 'query_agents':   return { intent, answer: await handleAgentActivity(admin, profile) }
    case 'query_activity': return { intent, answer: await handleActivityFeed(admin, profile) }
    case 'query_overdue':  return { intent, answer: await handleOverdueReminders(admin, profile) }
    case 'query_schedule': return { intent, answer: await handleQuerySchedule(admin, profile, body) }
    // Dates are inferred from prose, so this stages a confirmation like every
    // other write rather than booking straight away.
    case 'create_event':   return { intent, answer: await stageCreateEvent(admin, profile, body) }
    case 'help':           return { intent, answer: HELP_TEXT }
    case 'update_client':  return { intent, answer: await stageClientUpdate(admin, profile, result) }
    case 'update_property':return { intent, answer: await withListing(admin, profile, result, r => stagePropertyUpdate(admin, profile, r), true) }
    case 'update_deal':    return { intent, answer: await stageDealMove(admin, profile, result) }
    case 'query_pipeline': return { intent, answer: await handleQueryPipeline(admin, profile, result) }
    // Starts the multi-step flow, which finishes at the same confirmation step.
    // Never for the agent: it has create tools, and starting a flow here would
    // leave a half-filled form in conversation_state that it never resumes.
    case 'create_property':return { intent, answer: opts.forAgent ? USE_AGENT_CREATE_TOOL : await startCreatePropertyFlow(admin, profile, result) }
    case 'create_client':  return { intent, answer: opts.forAgent ? USE_AGENT_CREATE_TOOL : await startCreateClientFlow(admin, profile, result) }
    case 'feedback':       return { intent, answer: await stageFeedback(admin, profile, result, body) }
    // Only reached for phrasings the local matcher missed ("go on then").
    case 'confirm':
    case 'cancel':
      return { intent, answer: NOTHING_PENDING }
    // The model read it as a reminder reply, but nothing is outstanding — otherwise
    // the local matcher above would have handled it.
    case 'reminder_response':
      return { intent, answer: `You have no follow-up reminders waiting.\n\n${HELP_TEXT}` }
    default:
      return { intent, answer: `Sorry, I didn't understand that.\n\n${HELP_TEXT}` }
  }
}
