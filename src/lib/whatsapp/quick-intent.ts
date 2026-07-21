// Deterministic intent matching, tried before Grok.
//
// This exists because of a real production failure, not as an optimisation.
// Twilio abandons a webhook after 15 seconds and reports error 11200. Grok is a
// reasoning model whose latency is highly variable — measured between 2.3s and
// 9.4s on identical infrastructure, and 14s on a longer message, which blew the
// budget and cost the agent their reply even though the answer was correct.
//
// The messages agents actually send are overwhelmingly formulaic. Matching those
// here answers them in milliseconds and leaves Grok for genuinely open-ended
// text, where a slower path is acceptable because it's rare.
//
// Pure and unit-tested: no network, no database.

import type { IntentResult } from '@/lib/whatsapp/intent'
import { toMoney } from './writes.ts'

/** "500k in Beirut" → { budget, location } */
function budgetAndLocation(text: string): { budget?: number; location?: string } {
  const out: { budget?: number; location?: string } = {}

  const money = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*([km])\b|\$\s*([\d,]{4,})|\b(\d[\d,]{4,})\b/i)
  if (money) {
    const raw = money[1] ? `${money[1]}${money[2] ?? ''}` : (money[3] ?? money[4] ?? '')
    const n = toMoney(raw)
    if (n) out.budget = n
  }

  // "in Beirut", "in Hamra" — stop at punctuation or a trailing qualifier.
  const loc = text.match(/\bin\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'-]{1,30}?)(?:\s*[.,?!]|\s+(?:for|with|under|budget|area)\b|$)/i)
  if (loc) {
    const cleaned = loc[1].trim()
    if (cleaned && !/^(the|a|an)$/i.test(cleaned)) out.location = cleaned
  }

  return out
}

const CLIENT_STATUS_WORDS: Record<string, string> = {
  searching: 'Searching', viewing: 'Viewing', negotiating: 'Negotiating',
  closed: 'Closed', inactive: 'Inactive',
}
const PROPERTY_STATUS_WORDS: Record<string, string> = {
  sold: 'Sold', rented: 'Rented', available: 'Available', reserved: 'Reserved',
}

/**
 * Classify without a model call. Returns null when the message isn't one of the
 * recognised shapes, so the caller falls back to Grok rather than guessing.
 */
export function quickIntent(raw: string | null | undefined): IntentResult | null {
  const text = (raw ?? '').trim()
  if (!text) return null

  // ── help ──────────────────────────────────────────────────────────────────
  // "?" is tested separately: \b after \? requires a following word character,
  // so a bare question mark never matches inside the alternation.
  if (text === '?' || /^(help|menu|commands|what can you do)\b/i.test(text)) {
    return { intent: 'help' }
  }

  // ── manager reports ───────────────────────────────────────────────────────
  if (/\b(team|agents?)\b.*\b(doing|activity|performance|stats)\b/i.test(text)
      || /\b(agent activity|team report|how are (the )?agents)\b/i.test(text)) {
    return { intent: 'query_agents' }
  }
  if (/\b(overdue|late|behind)\b.*\b(follow[- ]?ups?|reminders?|calls?)\b/i.test(text)
      || /\b(follow[- ]?ups?|reminders?)\b.*\b(overdue|late|due)\b/i.test(text)) {
    return { intent: 'query_overdue' }
  }

  // ── "mark property #23 as sold" ───────────────────────────────────────────
  const propStatus = text.match(/\bproperty\s*#?\s*(\d+)\b[^.]*?\b(sold|rented|available|reserved)\b/i)
    || text.match(/\b(sold|rented|available|reserved)\b[^.]*?\bproperty\s*#?\s*(\d+)\b/i)
  if (propStatus) {
    const id = Number(propStatus[1].match(/^\d+$/) ? propStatus[1] : propStatus[2])
    const word = (propStatus[2].match(/^\d+$/) ? propStatus[1] : propStatus[2]).toLowerCase()
    if (Number.isFinite(id) && PROPERTY_STATUS_WORDS[word]) {
      return { intent: 'update_property', propertyId: id, fields: { status: PROPERTY_STATUS_WORDS[word] } }
    }
  }

  // ── "property #23" on its own → look it up ────────────────────────────────
  const propOnly = text.match(/^(?:info (?:on|about)\s+)?property\s*#?\s*(\d+)\s*\??$/i)
  if (propOnly) return { intent: 'query_property', propertyId: Number(propOnly[1]) }

  // ── "set Ahmed's budget to 400k" ──────────────────────────────────────────
  const budgetSet = text.match(/^(?:set|update|change)\s+(.+?)(?:'s|s')?\s+budget\s+(?:to|=)\s*(.+)$/i)
  if (budgetSet) {
    const budget = toMoney(budgetSet[2])
    if (budget) {
      return { intent: 'update_client', clientName: budgetSet[1].trim(), fields: { budget } }
    }
  }

  // ── "mark Ahmed as closed" ────────────────────────────────────────────────
  const clientStatus = text.match(/^(?:mark|set)\s+(.+?)\s+(?:as\s+)?(searching|viewing|negotiating|closed|inactive)\s*$/i)
  if (clientStatus) {
    return {
      intent: 'update_client',
      clientName: clientStatus[1].trim(),
      fields: { status: CLIENT_STATUS_WORDS[clientStatus[2].toLowerCase()] },
    }
  }

  // ── "info on Ahmed" ───────────────────────────────────────────────────────
  // Checked after the update patterns so "set Ahmed's budget" isn't read as a query.
  const infoOn = text.match(/^(?:send me\s+)?(?:info|information|details|data)\s+(?:on|about|for)\s+(?:client\s+)?(.+?)\s*\??$/i)
  if (infoOn) {
    const name = infoOn[1].trim()
    // "info on properties in Beirut" is a listing query, not a client lookup.
    if (!/\b(propert|listing|apartment|villa|office|shop|land|chalet|building)/i.test(name)) {
      return { intent: 'query_client', clientName: name }
    }
  }

  // ── "what matches 500k in Beirut" / "properties in Hamra" ─────────────────
  if (/\b(match(es|ing)?|properties|listings|apartments?|villas?|offices?|shops?)\b/i.test(text)
      && !/^(add|create|list|post|register)\b/i.test(text)) {
    const { budget, location } = budgetAndLocation(text)
    if (budget || location) return { intent: 'query_property', budget, location }
    // A bare "show me the listings" still routes to the property handler, which
    // lists recent ones and explains how to narrow it down.
    if (/\b(show|list|what|which|any)\b/i.test(text)) return { intent: 'query_property' }
  }

  return null
}
