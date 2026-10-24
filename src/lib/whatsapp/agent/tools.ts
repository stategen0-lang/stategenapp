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
import { stageClientUpdate, stagePropertyUpdate } from '../write-handlers.ts'
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
    input_schema: object({ name: must('string', 'The client\'s name or phone number, as the agent wrote it.') }),
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
    description: `Change an existing client: budget, status, area, bedrooms, phone or rating. ${ONE_CHANGE_NOTE}`,
    input_schema: object({
      client_name: must('string', 'The client\'s name as the agent wrote it.'),
      budget: number('New budget in USD.'),
      status: choice(['Searching', 'Viewing', 'Negotiating', 'Closed', 'Inactive'], 'New status.'),
      area: text('New preferred area(s), comma-separated.'),
      beds: integer('Bedrooms.'),
      phone: text('New phone number.'),
      rating: integer('The agent\'s 1–5 star rating of the client.'),
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
    name: 'other_request',
    description: 'Everything else the CRM can do that has no tool of its own yet: moving a client\'s deal along the pipeline; logging, accepting or rejecting offers; booking viewings and meetings; the agent\'s schedule and overdue follow-ups; sending a listing to the marketing team; writing a listing description in English or Arabic; a shareable link to a listing; recent activity and team performance. Pass ONE clear instruction in plain English containing every detail needed, e.g. "move Ahmed Khoury to negotiating", "book a viewing with Rita tomorrow at 3pm for listing #45", "send #23 to marketing". Never use it to add or edit clients or listings — those have their own tools.',
    input_schema: object({ instruction: must('string', 'One clear, complete instruction in English.') }),
  },
]

export const WRITE_TOOLS = new Set(['create_client', 'create_listing', 'update_client', 'update_listing', 'other_request'])

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
  if (typeof v === 'string' && /^s*d[d,]*(.d+)?s*$/.test(v)) return Number(v.replace(/[,s]/g, ''))
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
    const said = typeof out[k] === 'string' ? (out[k] as string).trim().toLowerCase().replace(/[s_-]+/g, ' ') : ''
    const hit = values.find(v => v.toLowerCase().replace(/[s_-]+/g, ' ') === said)
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
export const ALREADY_STAGED = 'A change is already waiting for the agent\'s yes in this conversation turn. Do not prepare another — tell the agent to confirm or cancel the first one, and offer to do this next.'

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

export async function executeTool(ctx: ToolContext, name: string, rawInput: unknown, state: TurnState): Promise<ToolOutcome> {
  const input = conform(name, asInput(rawInput))

  // stage() keeps one live action per agent, so a second write in the same
  // turn would silently replace the first — the one the agent is about to see
  // and approve. other_request is included because it can stage too.
  if (WRITE_TOOLS.has(name) && state.staged) return { content: ALREADY_STAGED, isError: true }

  switch (name) {
    case 'find_client': {
      const clientName = str(input, 'name')
      if (!clientName) return { content: 'Which client? Give a name or phone number.', isError: true }
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
      const clientName = str(input, 'client_name')
      if (!clientName) return { content: 'Which client? Give their name.', isError: true }
      const fields = defined({
        budget: num(input, 'budget'),
        status: str(input, 'status'),
        location: str(input, 'area'),
        beds: num(input, 'beds'),
        phone: str(input, 'phone'),
        rating: num(input, 'rating'),
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
