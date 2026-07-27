// Public shareable listing links.
//
// Two jobs, both security-shaped:
//
//   1. A signed token, so listing URLs are not enumerable. `/l/5` would let
//      anyone walk every listing by incrementing the number; the token carries
//      the id plus an HMAC the visitor cannot forge, so only links an agent
//      actually shared resolve.
//
//   2. An ALLOWLIST of what a public page may show. A denylist ("strip notes")
//      fails open the day someone adds a new internal field; an allowlist fails
//      closed — a field is invisible until explicitly published. Owner name and
//      contact (stored on WhatsApp-created listings) and internal notes must
//      never reach a public page.
//
// Pure: the secret is passed in, so both functions are unit-tested without env.

import crypto from 'node:crypto'
import type { Property } from '@/lib/data'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(id: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`listing:${id}`).digest('hex').slice(0, 16)
}

/** An opaque, unguessable token for a listing id. */
export function makeShareToken(id: number, secret: string): string {
  return b64url(Buffer.from(`${id}.${sign(id, secret)}`, 'utf8'))
}

/** The id encoded in a token, or null if it is malformed or the signature is wrong. */
export function parseShareToken(token: string | null | undefined, secret: string): number | null {
  if (!token) return null
  let decoded: string
  try {
    decoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch { return null }

  const dot = decoded.lastIndexOf('.')
  if (dot <= 0) return null
  const id = Number(decoded.slice(0, dot))
  const sig = decoded.slice(dot + 1)
  if (!Number.isInteger(id) || id <= 0) return null

  const expected = sign(id, secret)
  // Constant-time compare so a forged token can't be tuned byte by byte.
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return id
}

/** The HMAC secret. Server-only; falls back to the service-role key so no new
 *  env var is required. Never sent to the browser. */
export function shareSecret(): string {
  return process.env.SHARE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'insecure-dev-secret'
}

// ── The public view of a listing ─────────────────────────────────────────────

export interface PublicListing {
  title: string
  type: string
  transaction: string
  price: number
  rent: number
  district: string
  city: string
  size: number
  beds: number
  baths: number
  parkings?: number
  buildingAge?: number
  garden: boolean
  balcony: boolean
  view: string
  status: string
  photos: string[]
  description: string
}

/**
 * Reduce a full property to only the fields a public page may show.
 *
 * Explicitly does NOT carry: internal notes, the owning agent code, or anything
 * in the raw row's JSON blob (owner name/contact live there and are never mapped
 * onto Property in the first place). If a new client-safe field is added, it is
 * added here on purpose.
 */
export function publicListing(p: Property, description: string): PublicListing {
  return {
    title: p.title,
    type: p.type,
    transaction: p.transaction,
    price: p.price,
    rent: p.rent,
    district: p.district,
    city: p.city,
    size: p.size,
    beds: p.beds,
    baths: p.baths,
    parkings: p.parkings,
    buildingAge: p.buildingAge,
    garden: p.garden,
    balcony: p.balcony,
    view: p.view,
    status: p.status,
    photos: Array.isArray(p.photos) ? p.photos : [],
    description,
  }
}
