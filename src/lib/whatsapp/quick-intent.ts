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
import { coerceDealTarget, findStageInText, type DealTarget } from './deals.ts'

/** Flatten a pipeline target into the intent's fields (only ever strings). */
function dealFields(t: DealTarget): Record<string, string> {
  return t.outcome === 'won' || t.outcome === 'lost'
    ? { stage: t.stage, outcome: t.outcome }
    : { stage: t.stage }   // non-closed clears outcome later; closed-unknown is asked
}

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

/**
 * A forwarded / first-person buyer enquiry — a person to register as a client,
 * not an agent searching existing listings. Keyed on a contact number or on
 * first-person "I'm looking to buy/rent" / "my name is", which an agent's own
 * property search never carries. When true we DON'T let the property-search
 * fast-path claim the message — it falls through to Grok, which extracts the
 * client's fields and classifies it create_client.
 */
function looksLikeClientEnquiry(text: string): boolean {
  // A Lebanese phone: +961…, a mobile/landline prefix + two 3-digit groups
  // ("03 445 210", "71 998 877", "01 234 567"). Deliberately not a bare 6-digit
  // run, so a plain budget like "350000" isn't mistaken for a number.
  const hasPhone =
    /\+?\b961\d{6,}/.test(text.replace(/[^\d+]/g, ''))
    || /\b(0?3|0?[789]\d|0[1-9])[\s-]?\d{3}[\s-]?\d{3}\b/.test(text)
  return hasPhone
    || /\bmy name is\b/i.test(text)
    || /\bi['’]?\s*a?m\s+looking\b/i.test(text)
    || /\blooking to (?:buy|rent|lease)\b/i.test(text)
    || /\bi (?:want|need|would like|wanna)\s+to\s+(?:buy|rent|lease)\b/i.test(text)
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

  // ── "send me the link for #23" / "share property 23" ──────────────────────
  // A share/link verb plus a listing id → hand back the public link. Requires a
  // number tied to a #/property/listing marker (or a bare id right after the
  // verb) so "share how the team is doing" can't be mistaken for it.
  if (/\b(share|link)\b/i.test(text)) {
    const m = text.match(/(?:#|\bpropert\w*|\blisting|\bprop|\bunit)\s*#?\s*(\d+)/i)
      || text.match(/^\s*(?:share|link|send(?:\s+me)?(?:\s+the)?(?:\s+link)?)\s+#?(\d+)\b/i)
    if (m) return { intent: 'share_listing', propertyId: Number(m[1]) }
    // A "link" request with no number is still a share request — the handler
    // asks which listing. Gated on "link" specifically so "share how the team is
    // doing" (also has no id) still reaches the team-report matcher below.
    if (/\blink\b/i.test(text)) return { intent: 'share_listing' }
  }

  // ── "write a description for #23" / "describe property 23" ─────────────────
  // A describe verb plus a listing id → generate a listing description. The
  // confirm-save step lets the agent reject a wrong id, so a loose number match
  // is safe here.
  if (/\bdescri(?:be|ption)\b/i.test(text)) {
    const m = text.match(/(?:#|\bpropert\w*|\blisting|\bunit)\s*#?\s*(\d+)/i)
      || text.match(/\bdescri(?:be|ption)\b\s*(?:for\s+|of\s+)?(?:the\s+)?#?(\d+)\b/i)
    if (m) return { intent: 'describe_property', propertyId: Number(m[1]) }
  }

  // ── "add a viewing with Ahmed tomorrow at 3pm" ────────────────────────────
  // Checked before the schedule query because "schedule" is both a verb and a
  // noun: "schedule a call" books one, "my schedule" asks for the list. This
  // needs a leading command verb AND a calendar noun, so the query form can't
  // match it. The listing exclusion keeps "add listing" out.
  if (/^(add|book|schedule|set up|put in|create)\b/i.test(text)
      && /\b(event|viewing|meeting|call|appointment|follow[- ]?up|reminder to)\b/i.test(text)
      && !/\b(listing|propert)/i.test(text)) {
    return { intent: 'create_event', notes: text }
  }

  // ── "add a client" / "new buyer Ahmed" ───────────────────────────────────
  // A command verb plus a person noun, and no property words (so "add a listing"
  // stays a listing).
  if (/^(add|create|register|new|save)\b/i.test(text)
      && /\b(client|customer|lead|buyer|renter|tenant)\b/i.test(text)
      && !/\b(listing|propert|apartment|villa|office|shop|chalet|building|land)\b/i.test(text)) {
    return { intent: 'create_client', notes: text }
  }

  // ── "what's on today" / "my schedule tomorrow" ────────────────────────────
  if (/\b(schedule|calendar|agenda|diary)\b/i.test(text)
      || /\bwhat('?s| is)?\s+(on|up|happening)\b/i.test(text)
      || /\bany(thing)?\s+(on|booked|scheduled)\b/i.test(text)) {
    return { intent: 'query_schedule', notes: text }
  }

  // ── "what's new" / "recent activity" → the activity feed ──────────────────
  // A feed of recent actions, distinct from the performance report below. The
  // agent(s) guard keeps "agent activity" routing to that report instead.
  if ((/\b(activity feed|recent activity|team activity|latest (updates?|activity))\b/i.test(text)
       || /\b(what'?s?\s+new|any(thing)?\s+new|any\s+updates?)\b/i.test(text)
       || /\bwhat (has |'?s )?happened\b/i.test(text))
      && !/\bagents?\b/i.test(text)) {
    return { intent: 'query_activity' }
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

  // ── pipeline moves: "move Ahmed to negotiating", "mark Ahmed as won" ───────
  // A deal move, distinct from a client status change: keyed on move verbs and
  // on won/lost (pipeline-only words). "mark Ahmed as closed" is left to the
  // client-status matcher below, so this never fights it.
  const dealMove = text.match(/^(?:move|advance|push|shift|progress|bump)\s+(.+?)(?:'s)?\s+(?:deal\s+)?(?:to|into|forward to|up to)\s+(?:the\s+)?(\w+)(?:\s+stage)?\s*$/i)
  if (dealMove) {
    const target = coerceDealTarget(dealMove[2])
    if (target) return { intent: 'update_deal', clientName: dealMove[1].trim(), fields: dealFields(target) }
  }
  const dealClose = text.match(/^(?:mark|set|close|closed)\s+(.+?)(?:'s)?\s+(?:deal\s+)?(?:as\s+)?(won|lost|sold)\s*$/i)
  if (dealClose) {
    const target = coerceDealTarget(dealClose[2])
    if (target) return { intent: 'update_deal', clientName: dealClose[1].trim(), fields: dealFields(target) }
  }

  // ── pipeline reads: "my pipeline", "what's in negotiation", "show my deals" ─
  if (/\bpipeline\b/i.test(text)
      || (/\bdeals?\b/i.test(text) && /\b(my|show|list|open|active|what|which|any|how many)\b/i.test(text))
      || /\b(what|whats|who|whos|any|anything|hows?)\b.*\b(?:in|at)\s+(?:the\s+)?(lead|contacted|viewing|negotiating|negotiation|closed|won|lost)\b/i.test(text)) {
    const stage = findStageInText(text)
    return { intent: 'query_pipeline', ...(stage ? { fields: { stage } } : {}) }
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

  // ── "info on Ahmed", "who is Ahmed", "pull up Ahmed" ──────────────────────
  // Checked after the update patterns so "set Ahmed's budget" isn't read as a
  // query. Several phrasings, all meaning "tell me about this client".
  const infoOn =
    text.match(/^(?:send me\s+)?(?:info|information|details|data|profile)\s+(?:on|about|for)\s+(?:client\s+)?(.+?)\s*\??$/i)
    || text.match(/^(?:who(?:'?s| is)|pull up|look up|bring up|find me)\s+(?:client\s+)?(.+?)\s*\??$/i)
  if (infoOn) {
    const name = infoOn[1].trim()
    // "who is available" / "info on properties in Beirut" are listing queries,
    // not client lookups — a property word in the name rules the client out.
    // Prefix match (no trailing \b) so "propert" catches "property"/"properties".
    if (name && !/\b(propert|listing|apartment|flat|villa|office|shop|land|chalet|building|house|studio|available|sold|rented)/i.test(name)) {
      return { intent: 'query_client', clientName: name }
    }
  }

  // ── "what matches 500k in Beirut" / "properties in Hamra" ─────────────────
  // A forwarded client enquiry ("looking to buy an apartment… 03 445 210") also
  // names a property type + budget + area, so it's excluded here — otherwise it
  // reads as a search and never reaches the create_client classifier.
  if (/\b(match(es|ing)?|properties|propertys|listings?|apartments?|flats?|villas?|houses?|offices?|shops?|studios?|chalets?)\b/i.test(text)
      && !/^(add|create|list|post|register)\b/i.test(text)
      && !looksLikeClientEnquiry(text)) {
    const { budget, location } = budgetAndLocation(text)
    if (budget || location) return { intent: 'query_property', budget, location }
    // A bare "show me the listings" still routes to the property handler, which
    // lists recent ones and explains how to narrow it down.
    if (/\b(show|list|what|which|any)\b/i.test(text)) return { intent: 'query_property' }
  }

  return null
}
