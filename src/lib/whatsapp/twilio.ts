// Twilio integration: request authentication + sending.
//
// Signature verification is the security boundary for this whole feature.
// Without it anyone who discovers the webhook URL could POST a forged `From`
// number and impersonate an agent — full read/write access to that company's
// clients and listings. Twilio signs every request; we recompute and compare.

import crypto from 'node:crypto'

/**
 * Recreate Twilio's X-Twilio-Signature.
 *
 * Algorithm (per Twilio docs): take the full request URL, append each POST
 * parameter as key+value with the keys sorted alphabetically, HMAC-SHA1 with
 * the auth token, then base64.
 */
export function buildSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

/**
 * Is this request genuinely from Twilio? Uses a timing-safe comparison so the
 * signature can't be guessed byte-by-byte.
 */
export function verifySignature(
  authToken: string,
  signature: string | null | undefined,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false
  const expected = buildSignature(authToken, url, params)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Escape the few characters that are special inside TwiML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * A TwiML reply. Responding inline is simpler and faster than a follow-up REST
 * call, and it needs no credentials.
 */
export function twimlMessage(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`
}

/** An acknowledged-but-silent reply (used when we deliberately don't answer). */
export function twimlEmpty(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
}

/**
 * Send a WhatsApp message via the REST API. Needed for outbound messages that
 * aren't a reply to an inbound one — i.e. the scheduled reminders.
 */
export async function sendWhatsApp(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_NUMBER
  if (!sid || !token || !from) return { ok: false, error: 'Twilio env vars are not configured' }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  })

  if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` }
  return { ok: true }
}
