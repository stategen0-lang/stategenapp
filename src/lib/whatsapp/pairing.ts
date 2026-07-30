// WhatsApp connect / opt-out helpers.
//
// Production onboarding (Meta-verified sender, no sandbox): an agent connects by
// texting a one-time code to the bot via a wa.me deep link. The inbound message
// proves they control the number and captures opt-in. This module is the pure,
// testable part — code generation, parsing the "connect <code>" message, the
// deep link, and recognising an opt-out ("STOP").

import { randomInt } from 'node:crypto'

// Unambiguous alphabet — no O/0/I/1 so a code read off a screen can't be mistyped.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PAIRING_CODE_LENGTH = 6
export const PAIRING_TTL_MINUTES = 15

/** A fresh pairing code, e.g. "K7M2Q9". */
export function generatePairingCode(len = PAIRING_CODE_LENGTH): string {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

/** Normalise a code for storage/compare: uppercase, strip non-alphabet chars. */
export function normalizeCode(raw: string | null | undefined): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Pull the code out of a "connect <code>" message. Requires the "connect" word
 * so a stray token can't be mistaken for a pairing attempt. Returns the
 * normalised code, or null.
 */
export function parseConnect(text: string | null | undefined): string | null {
  const m = String(text ?? '').trim().match(/^connect[\s:]+([a-z0-9][a-z0-9\s-]{3,20})$/i)
  if (!m) return null
  const code = normalizeCode(m[1])
  return code.length >= 4 ? code : null
}

/** The message the deep link pre-fills. */
export function connectText(code: string): string {
  return `connect ${code}`
}

/** wa.me deep link that opens WhatsApp to the bot with the code pre-filled.
 *  `botNumber` is any format; only its digits are used (wa.me wants no '+'). */
export function connectLink(botNumber: string, code: string): string {
  const digits = String(botNumber ?? '').replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(connectText(code))}`
}

/** A standalone opt-out message. Kept to explicit opt-out words so it never
 *  collides with the in-flow "cancel". */
export function isStopMessage(text: string | null | undefined): boolean {
  return /^(stop|stop all|stopall|unsubscribe|opt[\s-]?out)$/i.test(String(text ?? '').trim())
}

/** Has a pending pairing code expired? */
export function pairingExpired(expiresAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime()
  return Number.isNaN(t) || t <= now.getTime()
}
