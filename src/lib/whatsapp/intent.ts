// Intent classification.
//
// Deterministic matches run first (see replies.ts) — they're instant, free and
// can't be misread by a model. Grok is only consulted for genuinely open-ended
// messages.

// NB: the xAI client is imported lazily inside classifyIntent rather than at
// module scope. parseIntentJson is pure and unit-tested by a Node test runner
// that strips types but does not resolve the "@/" path alias, so a top-level
// runtime import here would make this whole module unloadable in tests.

export type Intent =
  | 'reminder_response'
  | 'feedback'
  | 'update_client'
  | 'update_property'
  | 'create_property'
  | 'query_client'
  | 'query_property'
  | 'query_agents'
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
  'reminder_response', 'feedback', 'update_client', 'update_property',
  'create_property', 'query_client', 'query_property', 'query_agents',
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

Intents:
- query_client: asking for information about a client ("send me info on Ahmed")
- query_property: asking about listings or matches ("what matches a 500k budget in Beirut")
- query_agents: asking how the team or a set of agents is performing ("how is the team doing", "agent activity")
- query_overdue: asking which follow-ups or reminders are late ("what follow-ups are overdue")
- update_client: wants to change a client record ("update Ahmed's budget to 400k")
- update_property: wants to change a listing ("mark property #23 as sold")
- create_property: wants to add a new listing (describes a property to add)
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

Examples:
"set Ahmed's budget to 400k" -> {"intent":"update_client","clientName":"Ahmed","fields":{"budget":400000}}
"mark property #23 as sold" -> {"intent":"update_property","propertyId":23,"fields":{"status":"Sold"}}
"add listing: 3 bed apartment in Hamra, Beirut, 450k, 180 sqm" -> {"intent":"create_property","fields":{"title":"3 bed apartment","beds":3,"neighborhood":"Hamra","location":"Beirut","price":450000,"size":180}}
"called Ahmed, he wants a viewing Saturday" -> {"intent":"feedback","clientName":"Ahmed","notes":"wants a viewing Saturday"}`

/**
 * Ask Grok to classify. Returns { intent: 'unknown' } rather than throwing, so
 * the webhook always has something to reply with.
 */
export async function classifyIntent(message: string): Promise<IntentResult> {
  if (!message || !message.trim()) return { intent: 'unknown' }

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: message },
  ]

  try {
    const { chat } = await import('@/lib/xai')
    // Generous budget: Grok is a reasoning model and spends a large, variable
    // number of tokens thinking before it writes. A small cap here returns an
    // empty string (the bug that silently broke AI descriptions).
    let raw = await chat(messages, { temperature: 0.1, max_tokens: 2000 })
    if (!raw || !raw.trim()) {
      raw = await chat(messages, { temperature: 0.1, max_tokens: 2000 })
    }
    return parseIntentJson(raw)
  } catch {
    return { intent: 'unknown' }
  }
}
