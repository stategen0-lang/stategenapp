// WhatsApp Cloud API transport (Meta, direct — replaces twilio.ts).
//
// This is the security boundary for the whole feature: Meta signs every webhook
// with the app secret, and we recompute the HMAC over the RAW request body and
// compare timing-safe. Without it, anyone who learns the URL could POST a forged
// sender and impersonate an agent — full read/write on that company's data.
//
// Unlike Twilio, Cloud API is asynchronous: the webhook is acknowledged with a
// bare 200 and the reply is sent as a separate Graph API call (see sendText).
// That removes Twilio's 15-second synchronous-reply limit, so Grok latency and
// template-generation time no longer risk a timeout.

import crypto from 'node:crypto'

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0'

/** The permanent system-user token (WHATSAPP_ACCESS_TOKEN), with a fallback to
 *  the original scaffold name so existing env setups keep working. */
export function accessToken(): string {
  return process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN || ''
}

/** Verify-token for the GET handshake (WHATSAPP_VERIFY_TOKEN), falling back to
 *  the scaffold name. */
export function verifyToken(): string {
  return process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || ''
}

/** The bot's own E.164 number, for the wa.me connect deep link. */
export function displayNumber(): string {
  return process.env.WHATSAPP_DISPLAY_NUMBER || ''
}

/**
 * Download an inbound media file (a photo an agent sent) by its Meta media id.
 * Two hops: resolve the id to a short-lived URL, then fetch the bytes — both
 * require the access token in the Authorization header.
 */
export async function downloadMedia(mediaId: string): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string }> {
  const token = accessToken()
  if (!token) return { ok: false, error: 'WhatsApp access token is not configured' }
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!metaRes.ok) return { ok: false, error: `media lookup failed (${metaRes.status})` }
    const meta = await metaRes.json() as { url?: string; mime_type?: string }
    if (!meta.url) return { ok: false, error: 'media url missing' }
    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } })
    if (!fileRes.ok) return { ok: false, error: `media download failed (${fileRes.status})` }
    return { ok: true, bytes: new Uint8Array(await fileRes.arrayBuffer()), mime: meta.mime_type || 'image/jpeg' }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/**
 * Is this webhook genuinely from Meta? HMAC-SHA256 of the *raw* request body
 * with the app secret, compared timing-safe to the `X-Hub-Signature-256` header
 * (`sha256=<hex>`).
 *
 * The raw bytes matter: re-serialising the parsed JSON would reorder keys or
 * change spacing and the digest would never match. Pass the exact string read
 * from `req.text()`.
 */
export function verifyMetaSignature(
  appSecret: string,
  signatureHeader: string | null | undefined,
  rawBody: string,
): boolean {
  if (!appSecret || !signatureHeader) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf-8').digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export interface InboundMessage {
  from: string        // sender wa_id, digits only (E.164 without '+')
  text: string        // message text, or the title of a tapped button/list row
  name: string        // WhatsApp profile display name, if provided
  messageId: string   // wamid... — used to dedupe Meta's at-least-once delivery
  type: string        // 'text' | 'interactive' | 'button' | 'flow' | 'image' | ...
  /** Present when the agent submitted a WhatsApp Flow form (the parsed fields). */
  flow?: { data: Record<string, unknown> }
  /** Present when the agent sent a photo — the Meta media id to download. */
  image?: { id: string; mime?: string; caption?: string }
}

/**
 * Pull the first user message out of a Cloud API webhook payload. Meta wraps
 * everything in entry[].changes[].value; the message is in value.messages[] and
 * the sender's display name in value.contacts[]. Returns null for status-only
 * callbacks (delivery/read receipts have value.statuses, no messages), which the
 * webhook simply acknowledges.
 */
export function parseInbound(payload: unknown): InboundMessage | null {
  try {
    const value = (payload as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] })
      ?.entry?.[0]?.changes?.[0]?.value
    if (!value) return null

    const messages = value.messages as Record<string, unknown>[] | undefined
    const msg = messages?.[0]
    if (!msg) return null   // status callback or nothing actionable

    const type = String(msg.type ?? '')
    const from = String(msg.from ?? '')
    const messageId = String(msg.id ?? '')

    // Free text is the common case. Interactive replies (buttons / list rows)
    // and template quick-reply buttons carry their label elsewhere — read it so
    // a future tap-to-fill UI routes through the same intent logic as typing.
    let text = ''
    let flow: { data: Record<string, unknown> } | undefined
    let image: { id: string; mime?: string; caption?: string } | undefined
    if (type === 'text') {
      text = String((msg.text as { body?: string } | undefined)?.body ?? '')
    } else if (type === 'image') {
      const img = msg.image as { id?: string; mime_type?: string; caption?: string } | undefined
      if (img?.id) image = { id: String(img.id), mime: img.mime_type, caption: img.caption }
      text = String(img?.caption ?? '')
    } else if (type === 'interactive') {
      const inter = msg.interactive as {
        button_reply?: { title?: string }
        list_reply?: { title?: string }
        nfm_reply?: { response_json?: string }
      } | undefined
      // A submitted WhatsApp Flow form arrives as an nfm_reply with the field
      // values in response_json.
      if (inter?.nfm_reply?.response_json) {
        try { flow = { data: JSON.parse(inter.nfm_reply.response_json) as Record<string, unknown> } } catch { /* ignore */ }
      }
      text = String(inter?.button_reply?.title ?? inter?.list_reply?.title ?? '')
    } else if (type === 'button') {
      text = String((msg.button as { text?: string } | undefined)?.text ?? '')
    }

    const contacts = value.contacts as { profile?: { name?: string } }[] | undefined
    const name = String(contacts?.[0]?.profile?.name ?? '')

    const base: InboundMessage = { from, text, name, messageId, type: flow ? 'flow' : type }
    if (flow) return { ...base, flow }
    if (image) return { ...base, image }
    return base
  } catch {
    return null
  }
}

/**
 * Address format the Graph API expects: digits only, no '+' and no "whatsapp:"
 * prefix (e.g. "+96181056376" → "96181056376"). Stored numbers are already
 * normalised E.164 and inbound senders arrive as bare digits, so stripping to
 * digits is all that is needed here.
 */
export function toCloudAddress(e164: string | null | undefined): string {
  return String(e164 ?? '').replace(/\D/g, '')
}

interface SendResult { ok: boolean; error?: string; id?: string }

async function post(body: Record<string, unknown>): Promise<SendResult> {
  const token = accessToken()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) return { ok: false, error: 'WhatsApp Cloud API env vars are not configured' }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  })

  const json = await res.json().catch(() => null) as { messages?: { id?: string }[]; error?: { message?: string } } | null
  if (!res.ok) return { ok: false, error: `Meta ${res.status}: ${json?.error?.message ?? 'send failed'}` }
  return { ok: true, id: json?.messages?.[0]?.id }
}

/**
 * Send a free-text WhatsApp message. Valid inside the 24-hour customer-service
 * window (the user messaged the bot first) — which covers the entire interactive
 * assistant, so no templates are needed for replies. `to` is any format; it is
 * reduced to the Graph address here.
 */
export async function sendText(to: string, body: string): Promise<SendResult> {
  return post({
    to: toCloudAddress(to),
    type: 'text',
    text: { preview_url: false, body },
  })
}

// A reply is plain text, text with up to 3 tap buttons, or text with a tap list
// (≤10 rows). The bot's handlers return this so a step that's really a choice
// (buyer/renter, sale/rent, property type) can be tapped instead of typed. A tap
// arrives back as its title text (parseInbound reads button_reply.title /
// list_reply.title), so the receiving side needs no special handling.
export type BotReply =
  | string
  | { text: string; buttons: { id: string; title: string }[] }
  | { text: string; list: { button: string; rows: { id: string; title: string }[] } }
  | { flow: { flowId: string; flowToken: string; cta: string; body: string; screen: string } }

export function replyText(reply: BotReply): string {
  if (typeof reply === 'string') return reply
  return 'flow' in reply ? reply.flow.body : reply.text
}

/** Send a BotReply — plain text, interactive buttons, or an interactive list. */
export async function sendReply(to: string, reply: BotReply): Promise<SendResult> {
  if (typeof reply === 'string') return sendText(to, reply)
  const cloudTo = toCloudAddress(to)
  if ('flow' in reply) {
    const f = reply.flow
    return post({
      to: cloudTo,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: f.body },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: f.flowToken,
            flow_id: f.flowId,
            flow_cta: f.cta,
            flow_action: 'navigate',
            flow_action_payload: { screen: f.screen },
          },
        },
      },
    })
  }
  if ('buttons' in reply) {
    return post({
      to: cloudTo,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: reply.text },
        // Meta allows at most 3 reply buttons; titles are capped at 20 chars.
        action: { buttons: reply.buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    })
  }
  return post({
    to: cloudTo,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: reply.text },
      // Button label ≤20 chars, ≤10 rows total, row titles ≤24 chars.
      action: {
        button: reply.list.button.slice(0, 20),
        sections: [{ rows: reply.list.rows.slice(0, 10).map(r => ({ id: r.id, title: r.title.slice(0, 24) })) }],
      },
    },
  })
}

/**
 * Send an approved message template. Required for proactive messages OUTSIDE the
 * 24-hour window (the daily reminder, new-listing alerts) — free text there is
 * silently rejected by Meta. `components` supplies the {{n}} variables.
 */
export async function sendTemplate(
  to: string,
  name: string,
  languageCode = 'en',
  components?: unknown[],
): Promise<SendResult> {
  return post({
    to: toCloudAddress(to),
    type: 'template',
    template: { name, language: { code: languageCode }, ...(components ? { components } : {}) },
  })
}
