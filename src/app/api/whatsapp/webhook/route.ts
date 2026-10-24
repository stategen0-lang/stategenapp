import { NextRequest, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyMetaSignature, parseInbound, verifyToken, sendReply, replyText, type BotReply, type InboundMessage } from '@/lib/whatsapp/cloud'
import { normalizePhone } from '@/lib/whatsapp/phone'
import { handleFlowSubmission } from '@/lib/whatsapp/flow-handlers'
import { parseConnect, isStopMessage, normalizeCode, pairingExpired } from '@/lib/whatsapp/pairing'
import { continuePhotoCollection, NO_REPLY } from '@/lib/whatsapp/photo-handlers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { route, type Profile, type Routed } from '@/lib/whatsapp/router'

// The reply runs in after(), which the platform stops at this limit. Set
// explicitly because an agent turn can take several model round-trips; the
// agent itself stops starting new rounds well before it (TURN_BUDGET_MS).
export const maxDuration = 120

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
  const photoReply = await continuePhotoCollection(admin, profile, inbound, origin)
  if (photoReply !== null) {
    await stamp({ intent: 'collect_photo' })
    // NO_REPLY: one of several photos sent together that has already been
    // answered — stay quiet rather than repeat the same message per photo.
    if (photoReply !== NO_REPLY) await answerWith(photoReply, 'collect_photo', profile)
    return
  }

  // Nothing to read: media with no caption, or a reaction/system event. Routing
  // an empty body only ever produced "didn't understand" plus the help menu.
  if (!body && !inbound.flow) {
    if (['video', 'audio', 'document', 'sticker'].includes(inbound.type)) {
      await stamp({ intent: 'unsupported_media' })
      await answerWith('I can only read text messages and listing photos here. Type what you need, or send "help".', 'unsupported_media', profile)
    } else {
      await stamp({ intent: 'ignored_empty' })   // e.g. a 👍 reaction
    }
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
  let intent: Routed['intent'] = 'unknown'
  try {
    const routed = await route(admin, profile, body, origin, { phone, inboundLogId })
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
  // Already cleaned of WhatsApp's invisible characters by parseInbound — see
  // clean-text.ts.
  const body = inbound.text
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
