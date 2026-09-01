// Conversational field extraction for the add-listing / add-client flow.
//
// While a create flow is open, every reply is read as natural language: pull
// whatever CRM fields the agent mentioned (a bare "500k" answers the field they
// were just asked; a rich "for sale, 3 beds, balcony" fills several at once).
//
// Lazy xai import (like intent.ts) so parseFieldsJson stays unit-testable under
// the type-stripping Node runner, which doesn't resolve the "@/" alias.

export type CreateFlow = 'create_property' | 'create_client'

const PROPERTY_KEYS =
  'type (apartment/villa/office/shop/land/building/chalet/showroom), transaction ("For Sale" or "For Rent"), ' +
  'location (city), neighborhood (area within the city), price (USD number), rent (USD per month number), ' +
  'beds, baths, size (sqm), parkings, ownerName, ownerContact (phone), view, notes'

const CLIENT_KEYS =
  'name, phone, clientType ("buyer" or "renter"), propertyType (apartment/villa/office/shop/land/…), ' +
  'location (area they want), budget (USD number), beds, baths, parkings'

function systemPrompt(flow: CreateFlow, askedLabel?: string): string {
  const keys = flow === 'create_property' ? PROPERTY_KEYS : CLIENT_KEYS
  const noun = flow === 'create_property' ? 'a property listing' : 'a client / lead'
  return [
    `A real-estate agent is adding ${noun} by chatting on WhatsApp.`,
    `Extract any of these fields from the agent's message and reply with a SINGLE JSON object {"fields":{...}} and nothing else.`,
    `Use ONLY these keys (omit any you can't fill, never invent a value): ${keys}.`,
    askedLabel ? `The agent was just asked for "${askedLabel}", so a bare value (e.g. "500k", "achrafieh", "for sale") answers that.` : '',
    `Money is a plain USD number: "500k" -> 500000, "1.2m" -> 1200000, "2000/month" -> 2000 (and set the rent/renter case).`,
    `Read through typos and casual phrasing.`,
    ``,
    `Examples:`,
    `"3 bed apartment in Hamra Beirut for sale 450k, 180sqm" -> {"fields":{"type":"apartment","transaction":"For Sale","location":"Beirut","neighborhood":"Hamra","price":450000,"beds":3,"size":180}}`,
    `"500k" -> {"fields":{"price":500000}}`,
    `"for rent, 1800 a month" -> {"fields":{"transaction":"For Rent","rent":1800}}`,
    `"owner is Joe Khoury 03 123456" -> {"fields":{"ownerName":"Joe Khoury","ownerContact":"03 123456"}}`,
    `"renter, budget 2000" -> {"fields":{"clientType":"renter","budget":2000}}`,
  ].filter(Boolean).join('\n')
}

/**
 * Pull the fields object out of a model reply. Tolerant of prose/code fences and
 * of a model that returns the flat fields object without the {"fields":…} wrapper.
 * Returns only plain string/number/boolean values. Pure — unit-tested.
 */
export function parseFieldsJson(raw: string | null | undefined): Record<string, string | number | boolean> {
  if (!raw) return {}
  let text = String(raw).trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  text = text.slice(start, end + 1)

  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) } catch { return {} }

  const raw2 = (parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields))
    ? (parsed.fields as Record<string, unknown>)
    : parsed
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(raw2)) {
    if (k === 'fields') continue
    if (typeof v === 'string') { const t = v.trim(); if (t) out[k] = t }
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
  }
  return out
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('extract timed out')), Math.max(ms, 1))),
  ])
}

/** Ask Grok to pull fields from a free-text reply. Returns {} on any failure so
 *  the flow always falls back to direct coercion of the asked field. */
export async function extractCreateFields(
  flow: CreateFlow, message: string, askedLabel?: string,
): Promise<Record<string, string | number | boolean>> {
  if (!message || !message.trim()) return {}
  try {
    const { chat } = await import('@/lib/xai')
    const raw = await withDeadline(
      chat(
        [
          { role: 'system' as const, content: systemPrompt(flow, askedLabel) },
          { role: 'user' as const, content: message },
        ],
        { temperature: 0.1, max_tokens: 1500 },
      ),
      9_000,
    )
    return parseFieldsJson(raw)
  } catch {
    return {}
  }
}
