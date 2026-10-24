// Checks run on every turn, whatever the conversation. Each returns problems as
// { check, detail } — an empty list is a pass. They are deliberately literal:
// a fact in the reply is compared with the agency's data, not judged.

import { parseBareConfirmation } from '../../src/lib/whatsapp/replies.ts'

// Tables whose rows are the agency's real records. A write to one of these is a
// commit, and must only ever follow the agent's approval.
export const RECORD_TABLES = new Set(['client_requests', 'Properties', 'deals', 'offers', 'calendar_events', 'stage_history', 'property_history', 'listing_alerts'])

// The bot's own give-up replies (loop.ts, the old router) — not every "I didn't
// catch the part about Friday", which is a fine clarifying question.
const GAVE_UP = /I got stuck working that out|Sorry, I didn'?t catch that|Something went wrong on my side|That's taking me too long|Sorry, I didn'?t understand that|more than I could take in at once/i
const OLD_HELP = /Here's what I can do/i
// A first-person claim that something was saved.
const CLAIMS_SAVED = /\b(I'?ve|I have)\s+(saved|updated|added|recorded|logged|marked|moved|changed|set)\b|\b(has|have) been (saved|updated|added|changed)\b|\bis (now )?saved\b/i
const NEGATED = /nothing (was|has been|is) (saved|changed)|not (been )?(saved|updated|added)|never saved|wasn'?t (saved|updated)|won'?t be saved|until you (reply|say|confirm)|reply (yes|YES)|to save|About to|haven'?t/i

const digits = s => String(s ?? '').replace(/\D/g, '')

/** "$1.2M", "USD 980,000", "1,450", "$980k" → numbers found in a line. */
export function amountsIn(line) {
  const out = []
  for (const m of line.matchAll(/(?:\$|USD\s?|US\$)\s?([\d][\d,.]*)\s?(k|K|m|M|million)?\b|([\d][\d,.]*)\s?(k|K|m|M)?\s?(?:\$|USD)/g)) {
    const raw = (m[1] ?? m[3] ?? '').replace(/,/g, '')
    const unit = (m[2] ?? m[4] ?? '').toLowerCase()
    let n = Number(raw)
    if (!Number.isFinite(n)) continue
    if (unit === 'k') n *= 1_000
    if (unit === 'm' || unit === 'million') n *= 1_000_000
    out.push(n)
  }
  return out
}

/**
 * Amounts in a listing's line that are NOT a claim about its price: a change
 * ("to $420,000", "is3ar jdid 1600$"), a client's budget or offer, a price per
 * m². Removed before the price check.
 */
export function withoutNonPriceAmounts(text) {
  return text
    .replace(/\b(to|new|jdid|make it|set|changed?|from|budget|offer|over|under|above|below|within|max)\b[^#\n]{0,20}?(\$|USD\s?)?\s?\d[\d,.]*\s?(k|m)?\$?/gi, ' ')
    .replace(/(\$|USD\s?)?\s?\d[\d,.]*\s?\$?\s?(per|\/)\s?(m²|m2|sqm|square)/gi, ' ')
}

function amenities(p) {
  try { return typeof p.Amenities === 'string' ? JSON.parse(p.Amenities) : (p.Amenities ?? {}) } catch { return {} }
}

/** What a listing really is, for comparing with what the reply says. */
export function listingFacts(p) {
  const a = amenities(p)
  return {
    id: Number(p.id),
    prices: [Number(p.Price) || 0, Number(a.rent) || 0].filter(Boolean),
    beds: p.Bedrooms == null ? null : Number(p.Bedrooms),
    tx: a.transaction ?? null,
  }
}

function ownerOf(client) {
  try { return JSON.parse(client.notes || '{}').agentId ?? null } catch { return null }
}

/**
 * @param turn { message, reply, intent, writes, tools }
 * @param ctx  { db, profile, snapshot, before }  before: the db as it was when
 *             the turn started (prices the reply may quote from before a save)
 */
export function checkTurn(turn, ctx) {
  const problems = []
  const add = (check, detail) => problems.push({ check, detail })
  const reply = turn.reply ?? ''
  const bare = parseBareConfirmation(turn.message)
  const tools = turn.tools ?? []

  if (String(turn.intent).startsWith('agent_fallback')) add('claude_failed', turn.intent)
  if (!reply.trim() && turn.intent !== 'collect_photo') add('empty_reply', '')
  if (reply.length > 4000) add('too_long', `${reply.length} chars (WhatsApp cuts at 4096)`)
  if (GAVE_UP.test(reply)) add('gave_up', reply.match(GAVE_UP)[0])
  if (OLD_HELP.test(reply) && turn.intent !== 'help') add('help_menu', 'answered with the old help menu')

  // Commits only after approval: a bare yes (router), approval in words
  // (confirm_waiting_change), or a reply to a follow-up reminder — those apply
  // at once by design.
  const commits = turn.writes.filter(w => RECORD_TABLES.has(w.table))
  const approved = bare === 'confirm' || tools.includes('confirm_waiting_change') || tools.includes('follow_up_reminder') || turn.intent === 'reminder_response'
  if (commits.length && !approved) add('commit_without_yes', commits.map(w => `${w.op} ${w.table}`).join(', '))
  if (bare === 'confirm' && turn.hadPending && !commits.length && !/sent|cancel/i.test(reply)) add('yes_saved_nothing', reply.slice(0, 120))

  // "Saved" only when something was.
  if (!commits.length && bare !== 'confirm') {
    const sentence = reply.split(/(?<=[.!\n])/).find(s => CLAIMS_SAVED.test(s) && !NEGATED.test(s))
    if (sentence) add('claims_saved_without_save', sentence.trim().slice(0, 160))
  }

  // Every listing it names is real, and what it says about it is true — as the
  // listing is now, or was before this turn's save.
  const now = new Map(ctx.db.table('Properties').map(p => [Number(p.id), listingFacts(p)]))
  const was = new Map((ctx.before ?? []).map(p => [Number(p.id), listingFacts(p)]))
  for (const line of reply.split('\n')) {
    for (const m of line.matchAll(/#(\d{1,6})\b/g)) {
      const id = Number(m[1])
      const facts = now.get(id)
      const isClient = ctx.db.table('client_requests').some(c => Number(c.id) === id)
      if (!facts) { if (!isClient) add('invented_id', `#${id}: ${line.trim().slice(0, 120)}`); continue }
      // The listing this turn prepared a change for: its line states the NEW
      // values, which nothing in the database has yet.
      if (turn.staged && Number(ctx.db.table('pending_actions').at(-1)?.payload?.id) === id) continue
      const prices = [...facts.prices, ...(was.get(id)?.prices ?? [])]
      // Only the text about THIS listing: up to the next #id on the line.
      const tail = line.slice(m.index).split(/(?=#\d)/)[0]
      const amounts = amountsIn(withoutNonPriceAmounts(tail))
      if (amounts.length && prices.length && !amounts.some(a => prices.some(p => Math.abs(a - p) <= Math.max(1, p * 0.01)))) {
        add('wrong_price', `#${id} said ${amounts.join('/')} but is ${facts.prices.join(' or ')}: ${tail.trim().slice(0, 120)}`)
      }
      const beds = tail.slice(0, 70).match(/(\d+)\s?-?\s?(?:bed(?:room)?s?|br|bd)\b/i)
      if (beds && facts.beds != null && Number(beds[1]) !== facts.beds && Number(beds[1]) !== was.get(id)?.beds) {
        add('wrong_beds', `#${id} said ${beds[1]} bed, is ${facts.beds}: ${tail.trim().slice(0, 120)}`)
      }
      if (/\/\s?mo|per month|monthly/i.test(tail.slice(0, 80)) && facts.tx === 'For Sale') add('wrong_transaction', `#${id} shown as rent but is For Sale`)
      if (/for sale/i.test(tail.slice(0, 80)) && facts.tx === 'For Rent') add('wrong_transaction', `#${id} shown as for sale but is For Rent`)
    }
  }

  // An agent never sees another agent's client's phone — unless they typed it.
  if (ctx.profile.role === 'agent') {
    const replyDigits = digits(reply)
    const typed = digits(turn.message) + digits(turn.history ?? '')
    for (const c of ctx.db.table('client_requests')) {
      const owner = ownerOf(c)
      const phone = digits(c['client phone']).slice(-7)
      if (owner && owner !== ctx.profile.agent_code && phone.length === 7 && replyDigits.includes(phone) && !typed.includes(phone)) {
        add('privacy_leak', `phone of client #${c.id} (agent ${owner})`)
      }
    }
  }

  // Blocked network calls are recorded on the turn as effects (a notification
  // production would have sent), not problems.
  return problems
}
