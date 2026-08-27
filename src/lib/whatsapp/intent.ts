// Intent classification.
//
// Deterministic matches run first (see replies.ts) — they're instant, free and
// can't be misread by a model. Grok is only consulted for genuinely open-ended
// messages.

// NB: the xAI client is imported lazily inside classifyIntent rather than at
// module scope. parseIntentJson is pure and unit-tested by a Node test runner
// that strips types but does not resolve the "@/" path alias, so a top-level
// runtime import here would make this whole module unloadable in tests.

import { quickIntent } from './quick-intent.ts'

export type Intent =
  | 'reminder_response'
  | 'feedback'
  | 'update_client'
  | 'update_property'
  | 'update_deal'
  | 'query_pipeline'
  | 'create_property'
  | 'query_client'
  | 'query_property'
  | 'query_agents'
  | 'query_activity'
  | 'query_schedule'
  | 'create_event'
  | 'create_client'
  | 'share_listing'
  | 'describe_property'
  | 'log_offer'
  | 'query_offers'
  | 'accept_offer'
  | 'reject_offer'
  | 'query_overdue'
  | 'confirm'
  | 'cancel'
  | 'help'
  | 'unknown'

export interface IntentResult {
  intent: Intent
  /** Free-text name the agent referred to, e.g. "Ahmed". */
  clientName?: string
  /** Numeric id if the agent said "property #23". */
  propertyId?: number
  /** Budget in USD mentioned in a property query. */
  budget?: number
  /** Location mentioned in a property query. */
  location?: string
  /** Field → value pairs for update intents. */
  fields?: Record<string, string | number | boolean>
  /** Anything else worth keeping (notes, sentiment). */
  notes?: string
}

const VALID: Intent[] = [
  'reminder_response', 'feedback', 'update_client', 'update_property', 'update_deal', 'query_pipeline',
  'create_property', 'query_client', 'query_property', 'query_agents', 'query_activity', 'query_schedule', 'create_event',
  'create_client', 'share_listing', 'describe_property', 'log_offer', 'query_offers', 'accept_offer', 'reject_offer',
  'query_overdue', 'confirm', 'cancel', 'help', 'unknown',
]

/**
 * Pull an IntentResult out of a model reply. Exported so the parsing (the part
 * that actually breaks) is unit-testable without calling the API.
 */
export function parseIntentJson(raw: string | null | undefined): IntentResult {
  if (!raw) return { intent: 'unknown' }

  // Models like to wrap JSON in prose or code fences — take the first object.
  let text = String(raw).trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return { intent: 'unknown' }
  text = text.slice(start, end + 1)

  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) } catch { return { intent: 'unknown' } }

  const intent = VALID.includes(parsed.intent as Intent) ? (parsed.intent as Intent) : 'unknown'
  const out: IntentResult = { intent }

  if (typeof parsed.clientName === 'string' && parsed.clientName.trim()) out.clientName = parsed.clientName.trim()
  if (typeof parsed.location === 'string' && parsed.location.trim()) out.location = parsed.location.trim()
  if (typeof parsed.notes === 'string' && parsed.notes.trim()) out.notes = parsed.notes.trim()

  const pid = Number(parsed.propertyId)
  if (Number.isFinite(pid) && pid > 0) out.propertyId = pid

  const budget = Number(parsed.budget)
  if (Number.isFinite(budget) && budget > 0) out.budget = budget

  if (parsed.fields && typeof parsed.fields === 'object' && !Array.isArray(parsed.fields)) {
    const fields = parsed.fields as Record<string, string | number | boolean>
    if (Object.keys(fields).length) out.fields = fields
  }

  return out
}

const SYSTEM = `You classify WhatsApp messages from real estate agents into one intent and extract any obvious entities.
Reply with a single JSON object and nothing else.

The agent is typing quickly on a phone. Expect typos, missing apostrophes,
abbreviations, and casual phrasing — read through them to the intent. Many
different wordings mean the same thing ("info on Ahmed" = "who is Ahmed" =
"pull up ahmed" = "details for ahmed"). Pick the closest intent and extract what
you can. Only answer "unknown" if you genuinely cannot tell what they want — a
best guess at a real intent is better than refusing a slightly misspelt message.

Intents:
- query_client: asking for information about a client ("send me info on Ahmed")
- query_property: the AGENT searching existing listings, with NO specific person attached ("what matches a 500k budget in Beirut")
- query_agents: asking how the team or a set of agents is PERFORMING — stats/numbers ("how is the team doing", "agent performance", "who is my top agent")
- query_activity: asking what has HAPPENED recently — a feed of recent actions, not stats ("what's new", "recent activity", "what did the team do today", "any updates", "latest")
- query_schedule: asking what is on their calendar ("what is on today", "my schedule tomorrow")
- create_event: wants a calendar entry ("book a viewing with Ahmed tomorrow at 3pm")
- query_overdue: asking which follow-ups or reminders are late ("what follow-ups are overdue")
- update_client: wants to change a client record ("update Ahmed's budget to 400k")
- update_property: wants to change a listing ("mark property #23 as sold")
- update_deal: wants to move a client's deal along the sales pipeline ("move Ahmed to negotiating", "mark Ahmed's deal as won")
- query_pipeline: asking about the deal pipeline or deals in a stage ("what's in negotiation", "show my pipeline", "what am I closing")
- create_property: wants to add a new listing (describes a property to add)
- create_client: wants to add a new client/lead/buyer/renter ("add a client", "new buyer Ahmed"), OR is forwarding a prospective client's own enquiry — a message that gives a person's name and/or phone number together with what property they're after. A property need with a name or phone attached is a new client to register, NOT a search (query_property).
- share_listing: wants a shareable public link to a listing to forward to a client ("send me the link for #23", "share property 23")
- describe_property: wants an AI-written listing description for a property ("write a description for #23", "describe listing 23")
- log_offer: log an offer or counter-offer on a deal ("offer 450k from Joe on #23", "counter Joe 470k", "buyer offered 500k on #12"). Put the amount in fields.amount (plain USD number). A CLIENT's offer is side "buyer" (default); the OWNER/agency countering is side "owner" ("counter" = owner).
- query_offers: asking where a negotiation stands ("offers on #23", "what's the offer on #12", "where does the negotiation stand for Joe")
- accept_offer: accept the current offer, closing the deal won ("accept Joe's offer", "accept the offer on #23")
- reject_offer: reject the current offer ("reject Joe's offer", "turn down the offer on #23")
- feedback: reporting the outcome of a call or a note about a client
- reminder_response: responding to a call reminder
- help: asking what the bot can do
- unknown: anything else

JSON shape (omit keys you cannot fill):
{"intent":"...","clientName":"...","propertyId":123,"budget":500000,"location":"...","fields":{"budget":400000},"notes":"..."}

Rules:
- budget is a plain number in USD: "400k" -> 400000, "1.2m" -> 1200000
- propertyId is the number in "#23"
- Never invent a client name that is not in the message.

For update_client, update_property and create_property, put the changes in "fields"
using ONLY these key names (anything else is discarded):
- client: budget, status, location, beds, phone, rating
  status must be one of: Searching, Viewing, Negotiating, Closed, Inactive
- property: status, price, rent, size, beds, baths, title, location, neighborhood, notes
  status must be one of: Available, Reserved, Sold, Rented
  "location" is the city, "neighborhood" is the area within it
For create_client, put fields using ONLY these keys: name, phone,
clientType (buyer|renter), propertyType, location, budget, beds, baths, parkings.
For log_offer, put the amount in fields.amount (plain USD number: "450k"->450000,
"1.2m"->1200000) and set fields.side to "owner" ONLY when the owner/agency is
countering ("counter …"); otherwise omit side (it defaults to the buyer).
For update_deal, put the target in "fields":
- stage must be one of: lead, contacted, viewing, negotiating, closed
- outcome (only when closing) must be one of: won, lost
For query_pipeline, if they name a stage put it in "fields" as stage (lead|contacted|viewing|negotiating|closed).

Examples (note the typos and varied phrasing):
"set Ahmed's budget to 400k" -> {"intent":"update_client","clientName":"Ahmed","fields":{"budget":400000}}
"chnge ahmeds budget 2 400k" -> {"intent":"update_client","clientName":"Ahmed","fields":{"budget":400000}}
"who is sara" -> {"intent":"query_client","clientName":"Sara"}
"pull up ahmed for me" -> {"intent":"query_client","clientName":"Ahmed"}
"any flats under 500k in beirut" -> {"intent":"query_property","budget":500000,"location":"Beirut"}
"mark property #23 as sold" -> {"intent":"update_property","propertyId":23,"fields":{"status":"Sold"}}
"send me the link for #23" -> {"intent":"share_listing","propertyId":23}
"share property 23 with the client" -> {"intent":"share_listing","propertyId":23}
"write a description for #23" -> {"intent":"describe_property","propertyId":23}
"can you write me a blurb for listing 23" -> {"intent":"describe_property","propertyId":23}
"offer 450k from Joe on #23" -> {"intent":"log_offer","clientName":"Joe","propertyId":23,"fields":{"amount":450000}}
"counter joe 470k" -> {"intent":"log_offer","clientName":"Joe","fields":{"amount":470000,"side":"owner"}}
"buyer offered 500k on #12 from Maya" -> {"intent":"log_offer","clientName":"Maya","propertyId":12,"fields":{"amount":500000}}
"offers on #23" -> {"intent":"query_offers","propertyId":23}
"where does the negotiation stand for joe" -> {"intent":"query_offers","clientName":"Joe"}
"accept joes offer" -> {"intent":"accept_offer","clientName":"Joe"}
"reject the offer on #23" -> {"intent":"reject_offer","propertyId":23}
"move ahmed to negotiating" -> {"intent":"update_deal","clientName":"Ahmed","fields":{"stage":"negotiating"}}
"ahmeds deal is won" -> {"intent":"update_deal","clientName":"Ahmed","fields":{"stage":"closed","outcome":"won"}}
"whats in negotiation" -> {"intent":"query_pipeline","fields":{"stage":"negotiating"}}
"show me my pipeline" -> {"intent":"query_pipeline"}
"prop 23 is sold" -> {"intent":"update_property","propertyId":23,"fields":{"status":"Sold"}}
"add listing: 3 bed apartment in Hamra, Beirut, 450k, 180 sqm" -> {"intent":"create_property","fields":{"title":"3 bed apartment","beds":3,"neighborhood":"Hamra","location":"Beirut","price":450000,"size":180}}
"book a viewing with ahmed tomorow at 3pm" -> {"intent":"create_event","clientName":"Ahmed","notes":"viewing tomorrow at 3pm"}
"whats on today" -> {"intent":"query_schedule"}
"whats new" -> {"intent":"query_activity"}
"recent activity" -> {"intent":"query_activity"}
"what did the team do today" -> {"intent":"query_activity"}
"any updates" -> {"intent":"query_activity"}
"add a client" -> {"intent":"create_client"}
"new buyer Ahmed looking for a villa in Hamra, budget 600k, 03111222" -> {"intent":"create_client","fields":{"name":"Ahmed","clientType":"buyer","propertyType":"villa","location":"Hamra","budget":600000,"phone":"03111222"}}
"Hi, I'm looking for a 2 bedroom apartment in Achrafieh around 250k, this is Joe Khoury 03 123456" -> {"intent":"create_client","fields":{"name":"Joe Khoury","clientType":"buyer","propertyType":"apartment","location":"Achrafieh","budget":250000,"beds":2,"phone":"03 123456"}}
"Client Rana 71 998877 wants to rent an office in Hamra, budget 2000/month" -> {"intent":"create_client","fields":{"name":"Rana","clientType":"renter","propertyType":"office","location":"Hamra","budget":2000,"phone":"71 998877"}}
"called Ahmed, he wants a viewing Saturday" -> {"intent":"feedback","clientName":"Ahmed","notes":"wants a viewing Saturday"}`

/**
 * How long the model gets before we give up on it.
 *
 * Twilio abandons a webhook at 15 seconds (error 11200). Measured non-model
 * overhead — signature check, profile lookup, pending/flow/reminder queries,
 * the handler's own reads and the reply — is about 1s, and Grok itself
 * typically takes 5-8s. 10s leaves Grok room to finish normally while keeping
 * the worst case near 11s, comfortably inside Twilio's limit.
 *
 * Sized deliberately: too tight and legitimate classifications are thrown away
 * (7s cut off a valid feedback message during testing); too loose and the reply
 * is lost entirely, which is strictly worse than answering "I didn't understand".
 */
const GROK_DEADLINE_MS = 10_000

/** Reject if `promise` hasn't settled within `ms`. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('classification timed out')), Math.max(ms, 1))),
  ])
}

/**
 * Ask Grok to classify. Returns { intent: 'unknown' } rather than throwing, so
 * the webhook always has something to reply with.
 */
export async function classifyIntent(message: string): Promise<IntentResult> {
  if (!message || !message.trim()) return { intent: 'unknown' }

  // Formulaic messages are matched locally and never reach the model. This is a
  // latency requirement, not an optimisation: Twilio abandons the webhook at 15
  // seconds, and a slow classification costs the agent their reply entirely.
  const quick = quickIntent(message)
  if (quick) return quick

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: message },
  ]

  const started = Date.now()
  try {
    const { chat } = await import('@/lib/xai')
    // Generous token budget: Grok is a reasoning model and spends a large,
    // variable number of tokens thinking before it writes. A small cap returns
    // an empty string (the bug that silently broke AI descriptions).
    //
    // The wall-clock deadline is separate and non-negotiable — better to answer
    // "I didn't understand" quickly than to be cut off with no reply at all.
    let raw = await withDeadline(chat(messages, { temperature: 0.1, max_tokens: 2000 }), GROK_DEADLINE_MS)

    // Retry an empty completion only when the first call failed fast enough
    // that a second one can still finish inside the budget. Retrying late is
    // how a request ends up past Twilio's limit with nothing to show for it.
    const elapsed = Date.now() - started
    if ((!raw || !raw.trim()) && elapsed < 2500) {
      raw = await withDeadline(chat(messages, { temperature: 0.1, max_tokens: 2000 }), GROK_DEADLINE_MS - elapsed)
    }
    return parseIntentJson(raw)
  } catch {
    return { intent: 'unknown' }
  }
}
