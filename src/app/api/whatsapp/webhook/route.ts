import { NextRequest, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyMetaSignature, parseInbound, verifyToken, sendReply, replyText, type BotReply, type InboundMessage } from '@/lib/whatsapp/cloud'
import { normalizePhone } from '@/lib/whatsapp/phone'
import { parseConfirmation, parseReminderReply } from '@/lib/whatsapp/replies'
import { classifyIntent, Intent } from '@/lib/whatsapp/intent'
import { handleQueryClient, handleQueryProperty, handleShareListing, HELP_TEXT } from '@/lib/whatsapp/handlers'
import {
  stageClientUpdate, stagePropertyUpdate, stageFeedback, stageDescribeProperty,
  applyPendingAction, handleReminderReply,
} from '@/lib/whatsapp/write-handlers'
import { startCreatePropertyFlow, startCreateClientFlow, continueFlow, handleFlowSubmission } from '@/lib/whatsapp/flow-handlers'
import { stageDealMove, handleQueryPipeline } from '@/lib/whatsapp/pipeline-handlers'
import { isStartListing, isStartClient } from '@/lib/whatsapp/flows'
import { parseConnect, isStopMessage, normalizeCode, pairingExpired } from '@/lib/whatsapp/pairing'
import { handleAgentActivity, handleOverdueReminders, handleActivityFeed } from '@/lib/whatsapp/manager-handlers'
import { stageLogOffer, stageResolveOffer, handleQueryOffers, continueOfferPick } from '@/lib/whatsapp/offer-handlers'
import { continuePhotoCollection } from '@/lib/whatsapp/photo-handlers'
import { stageCreateEvent, continueEventFlow, handleQuerySchedule } from '@/lib/whatsapp/calendar-handlers'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Profile {
  id: string
  company_id: number
  role: string
  agent_code: string | null
  Full_name: string | null
  whatsapp_number: string | null
  whatsapp_enabled: boolean | null
}

async function log(
  admin: SupabaseClient,
  row: {
    company_id?: number | null
    profile_id?: string | null
    from_number?: string | null
    direction: 'inbound' | 'outbound'
    message: string
    intent?: string | null
    wa_message_id?: string | null
  },
): Promise<string | null> {
  try {
    const { data } = await admin.from('whatsapp_logs').insert(row).select('id').maybeSingle()
    return (data?.id as string) ?? null
  } catch {
    // The wa_message_id column may not exist yet (migration 013). Retry without
    // it so logging — and therefore replies — never break on a schema lag.
    if ('wa_message_id' in row) {
      const { wa_message_id: _omit, ...rest } = row
      void _omit
      try {
        const { data } = await admin.from('whatsapp_logs').insert(rest).select('id').maybeSingle()
        return (data?.id as string) ?? null
      } catch { return null }
    }
    return null   // logging must never break a reply
  }
}

/**
 * Decide the reply. Split out from POST so each branch simply returns, rather
 * than assigning into a variable that later branches could still overwrite.
 *
 * Order matters, and the handlers must stay inline: several of them write to
 * the database, so hoisting one into a const above the branches applies it even
 * when a different branch ends up answering. That bug shipped briefly in Phase 4.
 */
async function route(
  admin: SupabaseClient,
  profile: Profile,
  body: string,
  origin: string,
): Promise<{ intent: Intent | 'confirm_pending'; answer: BotReply }> {
  // A write waiting on "yes" outranks anything a model might infer.
  const { data: pending } = await admin
    .from('pending_actions')
    .select('id, action_type, summary, payload, expires_at')
    .eq('profile_id', profile.id)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const confirmation = parseConfirmation(body)

  if (pending && confirmation !== 'unknown') {
    // Consume the action first, whichever way it goes: a pending write must
    // never be applicable twice.
    await admin.from('pending_actions').delete().eq('id', pending.id)
    return {
      intent: 'confirm_pending',
      answer: confirmation === 'confirm'
        ? await applyPendingAction(admin, profile, pending.action_type, pending.payload)
        : 'Cancelled — nothing was saved.',
    }
  }

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
      answer: 'There is nothing waiting for confirmation — it may have expired (confirmations last 10 minutes). Send the change again.',
    }
  }

  const result = await classifyIntent(body)

  // Grok is still asked, so any details in the message are extracted and the
  // flow can skip questions — but the routing decision is ours when the wording
  // is unambiguous.
  const intent = isStartListing(body) ? 'create_property'
    : isStartClient(body) ? 'create_client'
    : result.intent

  switch (intent) {
    case 'query_client':   return { intent, answer: await handleQueryClient(admin, profile, result) }
    case 'query_property': return { intent, answer: await handleQueryProperty(admin, profile, result) }
    case 'share_listing':  return { intent, answer: await handleShareListing(admin, profile, result, origin) }
    case 'describe_property': return { intent, answer: await stageDescribeProperty(admin, profile, result) }
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
    case 'update_property':return { intent, answer: await stagePropertyUpdate(admin, profile, result) }
    case 'update_deal':    return { intent, answer: await stageDealMove(admin, profile, result) }
    case 'query_pipeline': return { intent, answer: await handleQueryPipeline(admin, profile, result) }
    // Starts the multi-step flow, which finishes at the same confirmation step.
    case 'create_property':return { intent, answer: await startCreatePropertyFlow(admin, profile, result) }
    case 'create_client':  return { intent, answer: await startCreateClientFlow(admin, profile, result) }
    case 'feedback':       return { intent, answer: await stageFeedback(admin, profile, result, body) }
    // Only reached for phrasings the local matcher missed ("go on then").
    case 'confirm':
    case 'cancel':
      return { intent, answer: 'There is nothing waiting for confirmation — it may have expired (confirmations last 10 minutes). Send the change again.' }
    // Grok read it as a reminder reply, but nothing is outstanding — otherwise
    // the local matcher above would have handled it.
    case 'reminder_response':
      return { intent, answer: `You have no follow-up reminders waiting.\n\n${HELP_TEXT}` }
    default:
      return { intent, answer: `Sorry, I didn't understand that.\n\n${HELP_TEXT}` }
  }
}

/**
 * An unknown number texting "connect <code>". If the code matches an
 * outstanding, unexpired pairing on some profile, bind the number to it and
 * record opt-in. Returns the reply, or null if it wasn't a valid connect.
 */
async function tryPair(admin: SupabaseClient, phone: string, body: string): Promise<string | null> {
  const code = parseConnect(body)
  if (!code) return null

  const { data: match } = await admin
    .from('Profiles')
    .select('id, Full_name, whatsapp_pending_code, whatsapp_pending_expires')
    .eq('whatsapp_pending_code', code)
    .maybeSingle<{ id: string; Full_name: string | null; whatsapp_pending_code: string | null; whatsapp_pending_expires: string | null }>()

  // Compare normalised, and re-check expiry here (not just in SQL) so a stale
  // code is never honoured.
  if (!match || normalizeCode(match.whatsapp_pending_code) !== code) {
    return "That code didn't match. Open Settings → WhatsApp in the app and tap Connect for a fresh link."
  }
  if (pairingExpired(match.whatsapp_pending_expires)) {
    return 'That code has expired. Open Settings → WhatsApp in the app and tap Connect for a new one.'
  }

  await admin.from('Profiles').update({
    whatsapp_number: phone,
    whatsapp_enabled: true,
    whatsapp_opt_in_at: new Date().toISOString(),
    whatsapp_pending_code: null,
    whatsapp_pending_expires: null,
  }).eq('id', match.id)

  const name = (match.Full_name ?? '').split(' ')[0]
  return `✅ You're connected${name ? `, ${name}` : ''}! I'm your StateGen assistant. Send "help" to see what I can do.\n\n(Reply STOP at any time to disconnect.)`
}

/** A connected user texting STOP: unbind and record the opt-out. */
async function optOut(admin: SupabaseClient, profile: Profile): Promise<string> {
  await admin.from('Profiles').update({
    whatsapp_number: null,
    whatsapp_enabled: false,
    whatsapp_opt_in_at: null,
    whatsapp_pending_code: null,
    whatsapp_pending_expires: null,
  }).eq('id', profile.id)
  return "You've been unsubscribed and won't get more messages here. To reconnect, open Settings → WhatsApp in the app and tap Connect."
}

/**
 * Resolve the sender, run the router, send the reply, and log both directions.
 * Runs under `after()` — off the response path — because the Cloud API is
 * asynchronous: we ack Meta's webhook with a fast 200 (below) and deliver the
 * answer with a separate Graph call here, so Grok/template latency can't cause a
 * webhook timeout or retry.
 */
async function handleInbound(
  inbound: InboundMessage,
  phone: string,
  body: string,
  inboundLogId: string | null,
  origin: string,
): Promise<void> {
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('Profiles')
    .select('id, company_id, role, agent_code, Full_name, whatsapp_number, whatsapp_enabled')
    .eq('whatsapp_number', phone)
    .maybeSingle<Profile>()

  // The inbound row was already created (for dedupe) in POST; here we stamp it
  // with the resolved company/profile/intent. Never breaks a reply.
  const stamp = async (fields: Record<string, unknown>) => {
    if (!inboundLogId) return
    try { await admin.from('whatsapp_logs').update(fields).eq('id', inboundLogId) } catch { /* never break a reply */ }
  }

  // Helper: send a reply (text or interactive buttons) and log the outbound row.
  const answerWith = async (reply: BotReply, intent: string, p?: Profile) => {
    const sent = await sendReply(inbound.from, reply)
    if (!sent.ok) console.error('[whatsapp] reply send failed', sent.error)
    await log(admin, {
      company_id: p?.company_id ?? null,
      profile_id: p?.id ?? null,
      from_number: phone,
      direction: 'outbound',
      message: replyText(reply),
      intent,
    })
  }

  if (!profile) {
    // Unknown number. The ONLY message we answer from an unregistered number is a
    // genuine "connect <code>" pairing attempt — every other message is ignored
    // silently, so the bot never replies to strangers, wrong numbers, or spam.
    const paired = await tryPair(admin, phone, body)
    if (paired === null) {
      await stamp({ intent: 'ignored_unregistered' })
      return
    }
    await stamp({ intent: 'connect' })
    await answerWith(paired, 'connect')
    return
  }

  await stamp({ company_id: profile.company_id, profile_id: profile.id })

  // A connected user texting STOP opts out (Meta requires honouring this), and
  // an account whose assistant is paused gets a short notice instead of replies.
  if (isStopMessage(body)) {
    await stamp({ intent: 'opt_out' })
    await answerWith(await optOut(admin, profile), 'opt_out', profile)
    return
  }
  if (profile.whatsapp_enabled === false) {
    await stamp({ intent: 'disabled' })
    await answerWith('The WhatsApp assistant is turned off for your account. Turn it back on in Settings → WhatsApp.', 'disabled', profile)
    return
  }

  // Just added a listing? A photo now gets attached to it; "done" or any other
  // message ends the window (and, if it wasn't a photo, routes normally below).
  const photoReply = await continuePhotoCollection(admin, profile, inbound)
  if (photoReply !== null) {
    await stamp({ intent: 'collect_photo' })
    await answerWith(photoReply, 'collect_photo', profile)
    return
  }

  // A submitted WhatsApp Flow form (native add-listing / add-client) — handled
  // apart from text routing; it goes straight to confirm-before-write.
  if (inbound.flow) {
    let reply: BotReply
    try { reply = await handleFlowSubmission(admin, profile, inbound.flow.data) }
    catch (err) { console.error('[whatsapp] flow submission error', err); reply = 'Something went wrong saving the form. Please try again.' }
    await stamp({ intent: 'flow_submit' })
    await answerWith(reply, 'flow_submit', profile)
    return
  }

  let answer: BotReply
  let intent: Intent | 'confirm_pending' = 'unknown'
  try {
    const routed = await route(admin, profile, body, origin)
    intent = routed.intent
    answer = routed.answer
  } catch (err) {
    console.error('[whatsapp] handler error', err)
    intent = 'unknown'
    answer = 'Something went wrong on my side. Please try again in a moment.'
  }

  await stamp({ intent })
  await answerWith(answer, intent, profile)
}

/**
 * The public origin, for building absolute links in replies (share_listing).
 * Behind Vercel's proxy the internal request URL is http on an internal host,
 * so the forwarded headers are what carry the real values.
 */
function originOf(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}`
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret) {
    console.error('[whatsapp] WHATSAPP_APP_SECRET is not set')
    return new Response('Not configured', { status: 500 })
  }

  // ── Authenticate the request ──────────────────────────────────────────────
  // HMAC over the RAW body — read it as text before any JSON parsing, because a
  // re-serialised payload would not reproduce Meta's digest. Without this check,
  // anyone who learns the URL could forge a sender and impersonate an agent.
  const raw = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  if (!verifyMetaSignature(appSecret, signature, raw)) {
    console.warn('[whatsapp] rejected request with an invalid signature')
    return new Response('Invalid signature', { status: 403 })
  }

  let payload: unknown
  try { payload = JSON.parse(raw) } catch { return new Response('Bad JSON', { status: 400 }) }

  const inbound = parseInbound(payload)
  // Status callbacks (delivery/read receipts) and anything non-actionable: just
  // acknowledge so Meta stops retrying.
  if (!inbound || !inbound.from) return new Response('ok', { status: 200 })

  const phone = normalizePhone(inbound.from)
  const body = inbound.text.trim()
  const admin = createAdminClient()

  // Atomic dedupe + inbound log in one insert. Meta delivers at-least-once, so
  // the same message id can arrive several times (and did, badly, while the
  // signature was misconfigured). The UNIQUE index on wa_message_id (migration
  // 013) makes a repeat delivery fail this insert with 23505, so we ack and skip
  // it — each message is processed exactly once. If the column isn't there yet,
  // we fall back to a plain insert (no dedupe) so the bot still works.
  let inboundLogId: string | null = null
  const claim = await admin
    .from('whatsapp_logs')
    .insert({ direction: 'inbound', message: body, from_number: phone, wa_message_id: inbound.messageId })
    .select('id')
    .maybeSingle()
  if (claim.error) {
    if (claim.error.code === '23505') return new Response('ok', { status: 200 }) // duplicate delivery
    const retry = await admin
      .from('whatsapp_logs')
      .insert({ direction: 'inbound', message: body, from_number: phone })
      .select('id')
      .maybeSingle()
    inboundLogId = (retry.data?.id as string) ?? null
  } else {
    inboundLogId = (claim.data?.id as string) ?? null
  }

  // Ack immediately; do the real work (classification, DB writes, the reply
  // send) after the response so webhook latency stays flat.
  after(() => handleInbound(inbound, phone, body, inboundLogId, originOf(req)))
  return new Response('ok', { status: 200 })
}

// Meta's webhook verification handshake: it GETs the URL with hub.mode,
// hub.verify_token and hub.challenge. Echo the challenge back as plain text when
// the token matches, else 403.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (mode === 'subscribe' && token && token === verifyToken()) {
    return new Response(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('Forbidden', { status: 403 })
}
