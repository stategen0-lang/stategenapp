// The agent's tools. Each one is a thin wrapper over a handler the bot already
// had — the same lookups, the same permission checks, the same confirm-before-
// write staging. What changes is who decides to call them: the model, reading
// the whole conversation, instead of a classifier reading one message.
//
// Two kinds:
//   • reads run straight away;
//   • writes only STAGE a change (pending_actions). The agent's "yes" is caught
//     by deterministic code in the webhook before the model is involved, and
//     that is what commits. No tool here can save anything on its own.
//
// Permissions stay in the handlers (canEditClient, canEditProperty, the name
// masking on other agents' clients), so the model cannot ask its way around
// them. Nothing here can message a client: the bot only ever talks to agents.

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '../write-handlers.ts'
import type { BotReply } from '../cloud.ts'
import type { IntentResult } from '../intent.ts'
import type { ToolOutcome, TurnState } from './loop.ts'
import { replyText } from '../cloud.ts'
import { stageClientUpdate, stagePropertyUpdate, applyPendingAction, stageDescribeProperty, stageArabicDescription, handleReminderReply, stageClientNote } from '../write-handlers.ts'
import { stageEvent, whenAt } from '../calendar-handlers.ts'
import { stageDealMove } from '../pipeline-handlers.ts'
import { requestMarketing } from '../marketing-handlers.ts'
import { startOfZonedDay } from '../timezone.ts'
import { photosFor } from '../photo-handlers.ts'
import type { EventKind } from '@/lib/calendar'
import { stageNewRecord } from '../flow-handlers.ts'
import { handleQueryClient, handleQueryProperty } from '../handlers.ts'
import { findListings, queryFromIntent } from '../listing-finder.ts'

type Tool = Anthropic.Beta.BetaTool
type Schema = Record<string, unknown>

export interface ToolContext {
  admin: SupabaseClient
  profile: Profile
  origin: string
  /**
   * The bot's existing classified router, for requests that have no native tool
   * yet (pipeline, offers, bookings, marketing…). A bridge, so turning the agent
   * on loses nothing; each capability moves to a real tool in turn.
   */
  legacy: (instruction: string) => Promise<BotReply>
}

// ── Schemas ──────────────────────────────────────────────────────────────────
// NOT strict tool use: strict mode allows only 16 nullable/union fields across
// all tools in a request, and these have ~70 — the API 400s every message.
// The guarantee strict mode would give is kept in code instead: every value is
// read by a type-checking helper below (a wrong type is dropped, never
// trusted), every choice is snapped to one of its listed values by conform(),
// and nothing a tool stages is saved until the agent says yes. Fields that may
// be null are optional; only the must() ones are required. The test suite
// checks every schema against the API's rules, since a schema the API rejects
// is a 400 on every message.

const nullable = (type: string, description: string, extra: Schema = {}): Schema =>
  ({ type: [type, 'null'], description, ...extra })
const text = (d: string) => nullable('string', d)
const number = (d: string) => nullable('number', d)
const integer = (d: string) => nullable('integer', d)
const flag = (d: string) => nullable('boolean', d)
const list = (d: string): Schema => ({ type: ['array', 'null'], items: { type: 'string' }, description: d })
// The API rejects an enum next to a type list ("Enum value 'For Sale' does not
// match declared type ['string', 'null']"), so a nullable choice is an anyOf.
const choice = (values: string[], d: string): Schema => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }], description: d })
const must = (type: string, d: string): Schema => ({ type, description: d })
const oneOf = (values: string[], d: string): Schema => ({ type: 'string', enum: values, description: d })

const isNullable = (p: Schema): boolean =>
  [].concat((p.type ?? []) as never).includes('null' as never)
  || ((p.anyOf ?? []) as Schema[]).some(o => o.type === 'null')

function object(properties: Record<string, Schema>): Tool['input_schema'] {
  const required = Object.keys(properties).filter(k => !isNullable(properties[k]))
  return { type: 'object', properties, required, additionalProperties: false }
}

const TRANSACTION = choice(['For Sale', 'For Rent'], 'For Sale or For Rent. Null if the agent did not say.')
const FURNISHING = choice(['Furnished', 'Semi-furnished', 'Unfurnished'], 'Furnishing.')
const PROPERTY_TYPE = text('Apartment, villa, duplex, studio, office, shop, land, chalet, building, warehouse…')
const FEATURES = list('Features in the agent\'s words: parking, elevator, generator, sea view, pets allowed, mid floor…')

const ONE_CHANGE_NOTE = 'Prepares the change for the agent to confirm — nothing is saved until they reply yes. Only one change can be waiting at a time.'

export const TOOLS: Tool[] = [
  {
    name: 'find_client',
    description: 'Look up one of the agency\'s clients by name or phone number and get their brief: what they want, budget, areas, status. Use before updating a client, or when the agent asks about one. Another agent\'s client comes back with the name and phone hidden — that is intentional; do not try to work around it.',
    input_schema: object({
      name: must('string', 'The client\'s name or phone number, as the agent wrote it.'),
      client_area: text('When several clients share the name or number: one area of the one meant, as the previous result listed it (e.g. Achrafieh).'),
    }),
  },
  {
    name: 'find_listings',
    description: 'Find specific existing listings by owner name or phone, words from the title, a listing number, or area — when the agent refers to a particular property ("the Khoury flat", "#45", "the villa in Broummana"). To find listings that FIT a client\'s needs, use match_listings instead.',
    input_schema: object({
      search: text('Owner name or phone, title words, or a listing number like #45.'),
      area: text('Area or neighbourhood.'),
      property_type: PROPERTY_TYPE,
      transaction: TRANSACTION,
      status: choice(['Available', 'Reserved', 'Sold', 'Rented'], 'Listing status.'),
    }),
  },
  {
    name: 'match_listings',
    description: 'Rank the agency\'s available listings against what a client wants — budget, areas, type, rent or sale, bedrooms — and return the best matches with a score and a link. Pass everything the agent said and leave the rest null. If they did not say rent or sale, leave transaction null and both are searched.',
    input_schema: object({
      transaction: TRANSACTION,
      property_type: PROPERTY_TYPE,
      areas: list('Every area the client would consider.'),
      budget: number('Budget in USD. For rentals, the monthly rent.'),
      beds: integer('Bedrooms wanted.'),
      size: integer('Size in m² the agent asked for ("130 sqm"). Results stay within ±10%, so 130 also finds 120 and 140.'),
      furnishing: FURNISHING,
      features: FEATURES,
    }),
  },
  {
    name: 'get_listing',
    description: 'Full details of one listing by its number.',
    input_schema: object({ listing_id: must('integer', 'The listing number, e.g. 45 for #45.') }),
  },
  {
    name: 'create_client',
    description: `Prepare a NEW client (buyer or renter). Use when the agent adds a client or forwards a person's enquiry — a name and/or phone together with what they are looking for. Fill every field the message gives and leave the rest null. Required: name, phone, client_type, property_type, at least one area, and budget; if any is missing the tool says which, and you ask for all of them in one message. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      name: text('The client\'s name.'),
      phone: text('Their phone number exactly as written.'),
      client_type: choice(['buyer', 'renter'], 'buyer or renter.'),
      property_type: PROPERTY_TYPE,
      areas: list('Every area they would consider.'),
      budget: number('USD. For renters the monthly rent. A range means its top end.'),
      beds: integer('Bedrooms.'),
      baths: integer('Bathrooms.'),
      parkings: integer('Parking spaces.'),
      min_size: number('Minimum size in m².'),
      view: text('Preferred view: sea, mountain, city…'),
      furnishing: FURNISHING,
      floor: text('Preferred floor, e.g. "mid floor", "no ground floor".'),
      balcony: flag('True if they need a balcony.'),
      features: FEATURES,
      notes: text('Anything that is not a field above — family, timing, pets, constraints.'),
      for_agent: text('Managers only: the agent this client belongs to, by name or ID. Null otherwise.'),
    }),
  },
  {
    name: 'create_listing',
    description: `Prepare a NEW listing. Fill every field the message gives and leave the rest null. Required: property_type, transaction, area, price, owner_name and owner_phone; if any is missing the tool says which, and you ask for all of them in one message. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      property_type: PROPERTY_TYPE,
      transaction: TRANSACTION,
      area: text('The single area or neighbourhood.'),
      price: number('Asking price in USD; for rentals, the monthly rent.'),
      owner_name: text('The owner\'s name.'),
      owner_phone: text('The owner\'s phone number exactly as written.'),
      beds: integer('Bedrooms.'),
      baths: integer('Bathrooms.'),
      parkings: integer('Parking spaces.'),
      size: number('Size in m².'),
      view: text('View: sea, mountain, city…'),
      floor: text('Floor, e.g. "3rd", "last floor".'),
      furnishing: FURNISHING,
      building_age: integer('Building age in years.'),
      garden: flag('Has a garden.'),
      balcony: flag('Has a balcony.'),
      terrace: flag('Has a terrace.'),
      features: FEATURES,
      notes: text('Anything that is not a field above.'),
      title: text('Only if the agent gave a title; otherwise null and the agency\'s title pattern is used.'),
    }),
  },
  {
    name: 'update_client',
    description: `Change an existing client: budget, status, area, bedrooms, phone, rating, or whether they're buying or renting. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      client_name: must('string', 'The client\'s name as the agent wrote it.'),
      client_area: text('Only when two clients share the name: one area of the one meant, as find_client or the error listed it (e.g. Achrafieh).'),
      budget: number('New budget in USD.'),
      status: choice(['Searching', 'Viewing', 'Negotiating', 'Closed', 'Inactive'], 'New status.'),
      area: text('New preferred area(s), comma-separated.'),
      beds: integer('Bedrooms.'),
      phone: text('New phone number.'),
      rating: integer('The agent\'s 1–5 star rating of the client.'),
      client_type: choice(['buyer', 'renter'], 'Only when they switch between buying and renting. Change the budget with it if it\'s now monthly rent (or the other way).'),
    }),
  },
  {
    name: 'update_listing',
    description: `Change an existing listing by its number: status (e.g. sold or rented), price, details or features. Find the number first with find_listings if the agent did not give it. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      listing_id: must('integer', 'The listing number.'),
      status: choice(['Available', 'Reserved', 'Sold', 'Rented'], 'New status.'),
      price: number('New price in USD; for rentals, the monthly rent.'),
      size: number('Size in m².'),
      beds: integer('Bedrooms.'),
      baths: integer('Bathrooms.'),
      parkings: integer('Parking spaces.'),
      title: text('New title.'),
      area: text('New area.'),
      view: text('View.'),
      floor: text('Floor.'),
      furnishing: FURNISHING,
      features: FEATURES,
      notes: text('Notes to add.'),
      owner_name: text('Owner\'s name.'),
      owner_phone: text('Owner\'s phone.'),
    }),
  },
  {
    name: 'book_event',
    description: `Put a viewing, meeting, call or follow-up in the agent's calendar. Work out the exact date from today's date in your context ("tomorrow", "Friday", "the 3rd") — if the day or time is unclear, ask instead of guessing. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      kind: oneOf(['viewing', 'meeting', 'call', 'follow_up'], 'What it is.'),
      date: must('string', 'The day, YYYY-MM-DD, in Beirut.'),
      time: text('Start time, HH:MM 24-hour (16:00 for 4pm). Null for an all-day reminder.'),
      title: must('string', 'Short title with who and what, e.g. "Viewing with Rita Haddad — #44 Sin el Fil Villa".'),
    }),
  },
  {
    name: 'move_deal',
    description: `Move a client's deal along the pipeline: lead → contacted → viewing → negotiating → won or lost. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      client_name: must('string', 'The client\'s name, or phone number.'),
      client_area: text('Only when two clients share the name: one area of the one meant.'),
      stage: oneOf(['lead', 'contacted', 'viewing', 'negotiating', 'won', 'lost'], 'The stage to move to.'),
    }),
  },
  {
    name: 'write_description',
    description: `Write a ready-to-post description of a listing, from what's on its record, to save to the listing. Arabic is a translation of the saved English one: if the listing has none yet, write the English first. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      listing_id: must('integer', 'The listing number.'),
      language: oneOf(['English', 'Arabic'], 'Which language.'),
      instructions: text('For an English rewrite: how the agent wants it written, in their words ("no neighbourhood line", "shorter", "no call to action"). Style only — it can\'t add facts.'),
    }),
  },
  {
    name: 'send_to_marketing',
    description: `Email a listing, with its photos, to the agency's marketing team. ${ONE_CHANGE_NOTE}`,
    input_schema: object({ listing_id: must('integer', 'The listing number.') }),
  },
  {
    name: 'queue_next_change',
    description: 'When the agent asks for more than one change at once ("add notes to #165 and #162", "mark #12 sold and #13 rented"): prepare the FIRST with its tool, then call this once for each of the others. Each is prepared automatically, one after another, as the one before it is approved — the agent never has to ask again. Only after preparing a change in this same reply.',
    input_schema: object({ instruction: must('string', 'The next change as one complete instruction with every detail, e.g. "add note to listing #162: confirm floor, main road and parking with the owner".') }),
  },
  {
    name: 'add_client_note',
    description: `Add a note to a client's file — "log that she's only free on weekends", "note on Reem's file: #24 and #60 pending a viewing", "he saw #45 and didn't like the kitchen". Appended with today's date to the Notes the agent sees in the app; nothing else on the client changes. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      client_name: must('string', "The client's name, phone number, or #number."),
      client_area: text('Only when two clients share the name: one area of the one meant.'),
      note: must('string', "The note, in the agent's words, cleaned up into one clear sentence or two."),
    }),
  },
  {
    name: 'attach_photos',
    description: 'Attach the photos the agent sent that are waiting for a listing (the conversation shows "📷 photo … — waiting for a listing" and you asked which listing) to the one they mean. Work out the listing from what they say — "the Achrafieh one I just added", "Khoury\'s flat" — with find_listings if needed. Also opens the listing for more photos. Saved straight away, like photos sent for a listing.',
    input_schema: object({ listing_id: must('integer', 'The listing number.') }),
  },
  {
    name: 'follow_up_reminder',
    description: 'Answer the follow-up reminder the agent was last sent ("Reminder: call …"): they did it, want it later, or the client is no longer interested. Only when their message is clearly about that reminder — a short "done" or "snooze 3 days" is handled for you before you see it. Saved straight away, like those.',
    input_schema: object({
      action: oneOf(['done', 'snooze', 'not_interested'], 'What happened.'),
      days: integer('For snooze: how many days. Null for the usual 3.'),
    }),
  },
  {
    name: 'other_request',
    description: 'Everything else the CRM can do that has no tool of its own yet: logging, accepting or rejecting offers; the agent\'s schedule and overdue follow-ups; a shareable link to a listing; recent activity and team performance; the pipeline overview. Pass ONE clear instruction in plain English containing every detail needed, e.g. "offer 450k from Joe Khoury on #23", "what\'s on my schedule tomorrow", "share link for #45". Never use it for anything that has its own tool.',
    input_schema: object({ instruction: must('string', 'One clear, complete instruction in English.') }),
  },
  {
    name: 'confirm_waiting_change',
    description: 'Save the change waiting for the agent\'s approval — the last "About to …" confirmation they were shown. Use it when their message approves that change as shown, with or without more words: "yes save it", "eh sa7", "ok go ahead", "correct", "تمام". If they approve but also change or add something ("yes but budget 1200"), do not use this — prepare the corrected change instead. Never for a change prepared in this same reply: the agent hasn\'t seen it yet.',
    input_schema: object({}),
  },
  {
    name: 'cancel_waiting_change',
    description: 'Drop the change waiting for the agent\'s approval, when they say not to save it: "no cancel", "la2 khalas", "forget it", "don\'t save". Nothing is saved.',
    input_schema: object({}),
  },
]

export const WRITE_TOOLS = new Set([
  'create_client', 'create_listing', 'update_client', 'update_listing',
  'book_event', 'move_deal', 'write_description', 'send_to_marketing', 'follow_up_reminder', 'add_client_note',
  'other_request', 'confirm_waiting_change', 'cancel_waiting_change',
])

// ── Reading the model's input ───────────────────────────────────────────────
// Strict mode already guarantees the shape; these still refuse to pass on
// anything that isn't the type expected, so one malformed value can't reach a
// handler.

type Input = Record<string, unknown>
const asInput = (v: unknown): Input => (v && typeof v === 'object' && !Array.isArray(v) ? v as Input : {})
const str = (i: Input, k: string): string | undefined => (typeof i[k] === 'string' && (i[k] as string).trim() ? (i[k] as string).trim() : undefined)
const num = (i: Input, k: string): number | undefined => {
  const v = i[k]
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  // Without strict mode a number can arrive as "1,000" — accept plain digits only.
  if (typeof v === 'string' && /^\s*\d[\d,]*(\.\d+)?\s*$/.test(v)) return Number(v.replace(/[,\s]/g, ''))
  return undefined
}
const bool = (i: Input, k: string): boolean | undefined => (typeof i[k] === 'boolean' ? i[k] as boolean : undefined)
const strs = (i: Input, k: string): string[] | undefined => {
  const v = i[k]
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim())
  return out.length ? out : undefined
}

/**
 * Snap every choice field to one of its listed values, ignoring case ("for
 * rent" → "For Rent"); a value not on the list is dropped. Strict mode would
 * have guaranteed this; without it, this is what does. Exported for tests.
 */
export function conform(name: string, input: Input): Input {
  const props = TOOLS.find(t => t.name === name)?.input_schema.properties as Record<string, Schema> | undefined
  if (!props) return input
  const out: Input = { ...input }
  for (const [k, p] of Object.entries(props)) {
    const values = (p.enum ?? ((p.anyOf ?? []) as Schema[]).find(o => o.enum)?.enum) as string[] | undefined
    if (!values || out[k] === undefined || out[k] === null) continue
    const said = typeof out[k] === 'string' ? (out[k] as string).trim().toLowerCase().replace(/[\s_-]+/g, ' ') : ''
    const hit = values.find(v => v.toLowerCase().replace(/[\s_-]+/g, ' ') === said)
    if (hit) out[k] = hit
    else delete out[k]
  }
  return out
}

/** Drop undefined so the handlers see only what the agent actually said. */
function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * match_listings' input as the matcher's brief. Exported so the mapping is
 * tested on its own.
 */
export function matchIntent(raw: unknown): IntentResult {
  const input = asInput(raw)
  return {
    intent: 'query_property',
    budget: num(input, 'budget'),
    locations: strs(input, 'areas'),
    // features stays an array: briefFromIntent reads it with list(), which
    // silently drops anything that isn't one. IntentResult types fields as
    // scalars, but every reader of features already expects a list.
    fields: defined({
      transaction: str(input, 'transaction'),
      type: str(input, 'property_type'),
      beds: num(input, 'beds'),
      furnishing: str(input, 'furnishing'),
      features: strs(input, 'features'),
      sizeAround: num(input, 'size'),
    }) as unknown as IntentResult['fields'],
  }
}

// ── Staging, detected from the database, not from wording ───────────────────

async function latestPending(admin: SupabaseClient, profileId: string): Promise<{ id: string; summary: string } | null> {
  const { data } = await admin
    .from('pending_actions')
    .select('id, summary')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? { id: String(data.id), summary: String(data.summary ?? '') } : null
}

export const STAGED_PREFIX = 'Prepared — NOT saved yet. The agent is shown this confirmation automatically, so do not repeat its details; add at most one short sentence if there is something they should know. Waiting on their yes:\n'
export const ALREADY_STAGED = 'One change per message: a change was already prepared, saved or cancelled in this reply. Do not do another — tell the agent you\'ll do this next, once they\'ve dealt with the first.'

export const NOTHING_WAITING = 'Nothing is waiting for the agent\'s approval — it was already saved or cancelled, or it expired (a prepared change waits 10 minutes). Tell the agent plainly, and offer to prepare it again if they still want it.'

/** The change the agent was last shown, if it's still live. */
async function waitingChange(admin: SupabaseClient, profileId: string) {
  const { data } = await admin
    .from('pending_actions')
    .select('id, action_type, summary, payload, expires_at')
    .eq('profile_id', profileId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { id: string; action_type: string; summary: string; payload: unknown } | null
}

/**
 * Run a handler that may stage a change, and report whether it did. Decided by
 * whether a new pending_actions row appeared — never by reading the reply,
 * which says "About to…" on success and something else on every refusal.
 */
async function staging(ctx: ToolContext, run: () => Promise<string>): Promise<ToolOutcome> {
  const before = await latestPending(ctx.admin, ctx.profile.id)
  const reply = await run()
  const after = await latestPending(ctx.admin, ctx.profile.id)
  return stagedOutcome(before, after) ?? { content: reply }
}

export const REPLACED_NOTE = 'It replaced a change that was waiting from earlier in the conversation. If that was a correction of it, fine; if it was something unrelated, tell the agent the earlier one was dropped.\n'

/**
 * The outcome when a new pending action appeared, or null. stage() keeps one
 * live action, so a new one always replaces whatever was waiting — the model is
 * told, so a correction reads as one and an unrelated change doesn't silently
 * drop the earlier one.
 */
function stagedOutcome(
  before: { id: string; summary: string } | null,
  after: { id: string; summary: string } | null,
): ToolOutcome | null {
  if (!after || after.id === before?.id) return null
  return { content: (before ? REPLACED_NOTE : '') + STAGED_PREFIX + after.summary, confirmation: after.summary }
}

// ── The dispatcher ──────────────────────────────────────────────────────────

/** The changes queued behind a pending one (payload.next). */
export function queueOf(payload: unknown): string[] {
  const next = (payload as { next?: unknown } | null)?.next
  return Array.isArray(next) ? next.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
}

/**
 * Run a tool — and when it prepares a change while an earlier queue is being
 * worked through, put the rest of the queue on the new change, so each approval
 * brings up the next.
 */
export async function executeTool(ctx: ToolContext, name: string, rawInput: unknown, state: TurnState): Promise<ToolOutcome> {
  const out = await runTool(ctx, name, rawInput, state)
  const prepared = out.confirmation && !out.leavesTurnOpen && name !== 'follow_up_reminder'
  if (prepared && state.queue?.length) {
    const pending = await waitingChange(ctx.admin, ctx.profile.id)
    if (pending) {
      await ctx.admin.from('pending_actions').update({ payload: { ...(pending.payload as Record<string, unknown>), next: state.queue } }).eq('id', pending.id)
    }
    state.queue = []
  }
  return out
}

async function runTool(ctx: ToolContext, name: string, rawInput: unknown, state: TurnState): Promise<ToolOutcome> {
  const input = conform(name, asInput(rawInput))

  // stage() keeps one live action per agent, so a second write in the same
  // turn would silently replace the first — the one the agent is about to see
  // and approve. other_request is included because it can stage too.
  if (WRITE_TOOLS.has(name) && state.staged) return { content: ALREADY_STAGED, isError: true }

  switch (name) {
    case 'find_client': {
      const name = str(input, 'name')
      if (!name) return { content: 'Which client? Give a name or phone number.', isError: true }
      // Live (simulator): "info on Rita Haddad in Achrafieh/Gemmayzeh" — the
      // agent named the area, and the lookup had no way to take it.
      const area = str(input, 'client_area')
      const clientName = area ? `${name} in ${area}` : name
      return { content: await handleQueryClient(ctx.admin, ctx.profile, { intent: 'query_client', clientName }) }
    }

    case 'find_listings': {
      const intent: IntentResult = {
        intent: 'find_listing',
        search: str(input, 'search'),
        location: str(input, 'area'),
        fields: defined({ type: str(input, 'property_type'), transaction: str(input, 'transaction'), status: str(input, 'status') }) as IntentResult['fields'],
      }
      return { content: (await findListings(ctx.admin, ctx.profile, queryFromIntent(intent))).reply }
    }

    case 'match_listings':
      return { content: await handleQueryProperty(ctx.admin, ctx.profile, matchIntent(input), ctx.origin) }

    case 'get_listing': {
      const propertyId = num(input, 'listing_id')
      if (!propertyId) return { content: 'Which listing? Give its number.', isError: true }
      return { content: await handleQueryProperty(ctx.admin, ctx.profile, { intent: 'query_property', propertyId }, ctx.origin) }
    }

    case 'create_client': {
      // The same keys the old classifier produced for this flow, so the forms'
      // coercion reads them exactly as before.
      const fields = defined({
        name: str(input, 'name'),
        phone: str(input, 'phone'),
        clientType: str(input, 'client_type'),
        propertyType: str(input, 'property_type'),
        locations: strs(input, 'areas'),
        budget: num(input, 'budget'),
        beds: num(input, 'beds'),
        baths: num(input, 'baths'),
        parkings: num(input, 'parkings'),
        size: num(input, 'min_size'),
        view: str(input, 'view'),
        furnishing: str(input, 'furnishing'),
        floor: str(input, 'floor'),
        balcony: bool(input, 'balcony'),
        features: strs(input, 'features'),
        notes: str(input, 'notes'),
      })
      return stageRecord(ctx, 'create_client', fields, str(input, 'for_agent'))
    }

    case 'create_listing': {
      const transaction = str(input, 'transaction')
      const price = num(input, 'price')
      const fields = defined({
        type: str(input, 'property_type'),
        transaction,
        location: str(input, 'area'),
        price,
        // A rental's figure is stored as the rent as well, matching the
        // listings the web form saves.
        rent: transaction === 'For Rent' ? price : undefined,
        ownerName: str(input, 'owner_name'),
        ownerContact: str(input, 'owner_phone'),
        beds: num(input, 'beds'),
        baths: num(input, 'baths'),
        parkings: num(input, 'parkings'),
        size: num(input, 'size'),
        view: str(input, 'view'),
        floor: str(input, 'floor'),
        furnishing: str(input, 'furnishing'),
        buildingAge: num(input, 'building_age'),
        garden: bool(input, 'garden'),
        balcony: bool(input, 'balcony'),
        terrace: bool(input, 'terrace'),
        features: strs(input, 'features'),
        notes: str(input, 'notes'),
        title: str(input, 'title'),
      })
      return stageRecord(ctx, 'create_property', fields, null)
    }

    case 'update_client': {
      const name = str(input, 'client_name')
      if (!name) return { content: 'Which client? Give their name.', isError: true }
      // resolveClient reads "<name> in <area>" to tell same-named clients apart.
      const area = str(input, 'client_area')
      const clientName = area ? `${name} in ${area}` : name
      const fields = defined({
        budget: num(input, 'budget'),
        status: str(input, 'status'),
        location: str(input, 'area'),
        beds: num(input, 'beds'),
        phone: str(input, 'phone'),
        rating: num(input, 'rating'),
        // Buyer/renter lives in two places — the type in the notes blob and the
        // deal in payment_terms — and the app writes both, so this does too.
        ...(str(input, 'client_type') ? {
          clientType: str(input, 'client_type') === 'renter' ? 'Renter' : 'Buyer',
          transaction: str(input, 'client_type') === 'renter' ? 'For Rent' : 'For Sale',
        } : {}),
      }) as IntentResult['fields']
      return staging(ctx, () => stageClientUpdate(ctx.admin, ctx.profile, { intent: 'update_client', clientName, fields }))
    }

    case 'update_listing': {
      const propertyId = num(input, 'listing_id')
      if (!propertyId) return { content: 'Which listing? Find its number with find_listings first.', isError: true }
      const fields = defined({
        status: str(input, 'status'),
        price: num(input, 'price'),
        size: num(input, 'size'),
        beds: num(input, 'beds'),
        baths: num(input, 'baths'),
        parkings: num(input, 'parkings'),
        title: str(input, 'title'),
        location: str(input, 'area'),
        view: str(input, 'view'),
        floor: str(input, 'floor'),
        furnishing: str(input, 'furnishing'),
        features: strs(input, 'features'),
        notes: str(input, 'notes'),
        ownerName: str(input, 'owner_name'),
        ownerContact: str(input, 'owner_phone'),
      }) as unknown as IntentResult['fields']   // features is a list; see match_listings
      return staging(ctx, () => stagePropertyUpdate(ctx.admin, ctx.profile, { intent: 'update_property', propertyId, fields }))
    }

    case 'other_request': {
      const instruction = str(input, 'instruction')
      if (!instruction) return { content: 'Give one clear instruction.', isError: true }
      return staging(ctx, async () => replyText(await ctx.legacy(instruction)))
    }

    // Exact fields straight to the handlers. Through other_request these were
    // written out as a sentence and re-read: "tomorrow" became today, a deal
    // move came back as the pipeline overview.
    case 'book_event': {
      const title = str(input, 'title')
      const date = str(input, 'date')
      if (!title || !date) return { content: 'A booking needs a title and a date.', isError: true }
      const when = whenAt(date, str(input, 'time'))
      if (!when) return { content: `"${date}${str(input, 'time') ? ` ${str(input, 'time')}` : ''}" isn't a valid date/time — use YYYY-MM-DD and HH:MM.`, isError: true }
      if (when.start.getTime() < startOfZonedDay().getTime()) {
        return { content: `${date} is in the past. Check the day with the agent.`, isError: true }
      }
      const kind = (str(input, 'kind') ?? 'meeting') as EventKind
      return staging(ctx, () => stageEvent(ctx.admin, ctx.profile, { title, kind, when }))
    }

    case 'move_deal': {
      const name = str(input, 'client_name')
      const stage = str(input, 'stage')
      if (!name || !stage) return { content: 'Which client, and which stage?', isError: true }
      const area = str(input, 'client_area')
      const closed = stage === 'won' || stage === 'lost'
      return staging(ctx, () => stageDealMove(ctx.admin, ctx.profile, {
        intent: 'update_deal',
        clientName: area ? `${name} in ${area}` : name,
        fields: closed ? { stage: 'closed', outcome: stage } : { stage },
      }))
    }

    case 'write_description': {
      const propertyId = num(input, 'listing_id')
      if (!propertyId) return { content: 'Which listing? Give its number.', isError: true }
      const arabic = str(input, 'language') === 'Arabic'
      return staging(ctx, () => (arabic ? stageArabicDescription : stageDescribeProperty)(ctx.admin, ctx.profile, {
        intent: arabic ? 'describe_property_ar' : 'describe_property', propertyId, notes: str(input, 'instructions'),
      }))
    }

    case 'send_to_marketing': {
      const propertyId = num(input, 'listing_id')
      if (!propertyId) return { content: 'Which listing? Give its number.', isError: true }
      return staging(ctx, async () => replyText(await requestMarketing(ctx.admin, ctx.profile, propertyId, ctx.origin)))
    }

    case 'add_client_note': {
      const name = str(input, 'client_name')
      const note = str(input, 'note')
      if (!name || !note) return { content: 'Which client, and what should the note say?', isError: true }
      const area = str(input, 'client_area')
      return staging(ctx, () => stageClientNote(ctx.admin, ctx.profile, area ? `${name} in ${area}` : name, note))
    }

    case 'attach_photos': {
      const propertyId = num(input, 'listing_id')
      if (!propertyId) return { content: 'Which listing? Give its number.', isError: true }
      return { content: await photosFor(ctx.admin, ctx.profile, propertyId) }
    }

    // The same handler a bare "done" / "snooze 3d" reaches in the router —
    // applied at once, as those are — for replies with more words.
    case 'follow_up_reminder': {
      const action = str(input, 'action') as 'done' | 'snooze' | 'not_interested' | undefined
      if (!action) return { content: 'Done, snooze, or not interested?', isError: true }
      const reply = await handleReminderReply(ctx.admin, ctx.profile, action, action === 'snooze' ? num(input, 'days') : undefined)
      if (reply === null) return { content: 'No follow-up reminder is waiting for a reply (they expire after 3 days). Nothing was changed.', isError: true }
      return { content: `Done. The agent is shown this automatically:\n${reply}`, confirmation: reply }
    }

    // The same commit a bare "yes" gets from the router, for approvals with
    // more words. Exactly what the agent was shown is saved — the payload was
    // fixed when it was prepared, and one prepared in this reply can't be
    // confirmed (state.staged, checked above). Consumed before it's applied,
    // so it can never be applied twice.
    case 'confirm_waiting_change': {
      const pending = await waitingChange(ctx.admin, ctx.profile.id)
      if (!pending) return { content: NOTHING_WAITING, isError: true }
      await ctx.admin.from('pending_actions').delete().eq('id', pending.id)
      const saved = replyText(await applyPendingAction(ctx.admin, ctx.profile, pending.action_type, pending.payload as never))
      const queued = queueOf(pending.payload)
      if (!queued.length) return { content: `Done. The agent is shown this automatically, so don't repeat it:\n${saved}`, confirmation: saved }
      // The next change they asked for, prepared in this same reply; whatever
      // follows it rides along on that one (executeTool attaches it).
      state.queue = queued.slice(1)
      return {
        content: `Done. The agent is shown this automatically, so don't repeat it:\n${saved}\n\nThey also asked for this, so prepare it now with the right tool: "${queued[0]}"`,
        confirmation: saved,
        leavesTurnOpen: true,
        keepWithNext: true,
      }
    }

    case 'cancel_waiting_change': {
      const pending = await waitingChange(ctx.admin, ctx.profile.id)
      if (!pending) return { content: NOTHING_WAITING, isError: true }
      await ctx.admin.from('pending_actions').delete().eq('id', pending.id)
      const queued = queueOf(pending.payload)
      return {
        content: 'Cancelled — nothing was saved. The agent is shown this automatically. If they also said what they want instead, prepare that now.'
          + (queued.length ? ` They had also asked for: "${queued.join('"; "')}" — ask whether they still want it rather than assuming.` : ''),
        confirmation: 'Cancelled — nothing was saved.',
        leavesTurnOpen: true,
      }
    }

    // "update both" — the second waits on the first. Not a write itself: it
    // rides on the change just prepared, and is prepared once that's approved
    // (by the router for a bare "yes", by confirm_waiting_change otherwise).
    case 'queue_next_change': {
      const instruction = str(input, 'instruction')
      if (!instruction) return { content: 'What is the next change?', isError: true }
      if (!state.staged) return { content: 'Prepare the first change first, then queue the others.', isError: true }
      const pending = await waitingChange(ctx.admin, ctx.profile.id)
      if (!pending) return { content: 'Nothing is waiting to queue it behind.', isError: true }
      const payload = { ...(pending.payload as Record<string, unknown>), next: [...queueOf(pending.payload), instruction] }
      await ctx.admin.from('pending_actions').update({ payload }).eq('id', pending.id)
      return { content: `Queued — it is prepared automatically once they approve the current change. Tell them so in a few words ("reply YES and I'll prepare the next one").` }
    }

    default:
      return { content: `There is no tool called ${name}.`, isError: true }
  }
}

async function stageRecord(
  ctx: ToolContext,
  flow: 'create_client' | 'create_property',
  fields: Record<string, unknown>,
  forAgent: string | null | undefined,
): Promise<ToolOutcome> {
  const before = await latestPending(ctx.admin, ctx.profile.id)
  const result = await stageNewRecord(ctx.admin, ctx.profile, flow, fields, forAgent)
  const roster = (agents: { code: string; name: string }[]) => agents.map(a => `${a.name} (${a.code})`).join(', ')

  switch (result.status) {
    case 'missing':
      return { content: `Not prepared yet — still needed: ${result.missing.join(', ')}. Ask the agent for all of these in one short message.` }
    case 'needs_agent':
      return { content: `Not prepared yet — the sender is a manager, so the client must be assigned to an agent. Ask which one: ${roster(result.agents)}.` }
    case 'unknown_agent':
      return { content: `Not prepared yet — "${forAgent}" isn't one of the agency's agents. Ask which one: ${roster(result.agents)}.` }
    case 'staged': {
      const after = await latestPending(ctx.admin, ctx.profile.id)
      // finish() returned without staging — it says why (usually a save error).
      return stagedOutcome(before, after) ?? { content: result.reply, isError: true }
    }
  }
}
