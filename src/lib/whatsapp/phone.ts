// Phone normalisation — the WhatsApp bot identifies an agent purely by the
// number a message arrives from, so this is the identity mechanism. Twilio
// sends "whatsapp:+9613870377", while numbers typed into the app look like
// "+961 3 870 377", "03 870 377" or "70 988 395". All of those must resolve to
// one canonical E.164 string or the agent silently won't be recognised.

export const DEFAULT_COUNTRY_CODE = '961' // Lebanon

/**
 * Canonical E.164, e.g. "+9613870377". Returns '' for input with no digits.
 *
 * Handles: a "whatsapp:" prefix, spaces/dashes/parentheses, a "00" international
 * prefix, a bare national number, and a national number written with the
 * trunk "0" (e.g. "03 870 377" → "+9613870377").
 */
export function normalizePhone(raw: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string {
  if (!raw) return ''

  // Twilio addresses look like "whatsapp:+961..." on both From and To.
  let s = String(raw).trim().replace(/^whatsapp:/i, '').trim()

  const hasPlus = s.startsWith('+')
  let digits = s.replace(/\D/g, '')
  if (!digits) return ''

  if (hasPlus) return '+' + digits

  // "00" is the international access prefix — same meaning as "+".
  if (digits.startsWith('00')) return '+' + digits.slice(2)

  // Already carries the country code.
  if (digits.startsWith(countryCode)) return '+' + digits

  // National format with the trunk zero: drop it before adding the country code.
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')

  return '+' + countryCode + digits
}

/** Do two numbers refer to the same line, however they were written? */
export function samePhone(a: string | null | undefined, b: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): boolean {
  const na = normalizePhone(a, countryCode)
  const nb = normalizePhone(b, countryCode)
  return na !== '' && na === nb
}

/** Loose E.164 sanity check — 8 to 15 digits after the "+". */
export function isValidPhone(raw: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): boolean {
  const n = normalizePhone(raw, countryCode)
  return /^\+\d{8,15}$/.test(n)
}

/** Address format Twilio expects when sending. */
export function toWhatsAppAddress(raw: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string {
  const n = normalizePhone(raw, countryCode)
  return n ? `whatsapp:${n}` : ''
}
