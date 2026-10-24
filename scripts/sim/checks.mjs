// Checks run on every turn, whatever the conversation. Each returns problems as
// { check, detail } — an empty list is a pass. They are deliberately literal:
// a fact in the reply is compared with the agency's data, not judged.

import { parseBareConfirmation } from '../../src/lib/whatsapp/replies.ts'

// Tables whose rows are the agency's real records. A write to one of these is a
// commit, and must only ever follow the agent's "yes".
export const RECORD_TABLES = new Set(['client_requests', 'Properties', 'deals', 'offers', 'calendar_events', 'stage_history', 'property_history', 'listing_alerts'])

const GAVE_UP = /didn'?t (understand|catch)|don'?t understand|not sure what you mean|something went wrong|try again in a moment|I got stuck|more than I could take|could you say it another way/i
const OLD_HELP = /Here's what I can do|Send "help"/i
const CLAIMS_SAVED = /\b(saved|updated|added|recorded|logged|marked|moved|changed)\b/i
const NEGATED = /nothing (was|has been|is) (saved|changed)|not (been )?(saved|updated|added)|never saved|wasn'?t (saved|updated)|won'?t be saved|until you (reply|say|confirm)|reply (yes|YES)|to save|About to/i

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
 * @param turn { message, reply, intent, writes, blocked }
 * @param ctx  { db, profile, snapshot }
 */
export function checkTurn(turn, ctx) {
  const problems = []
  const add = (check, detail) => problems.push({ check, detail })
  const reply = turn.reply ?? ''
  const bare = parseBareConfirmation(turn.message)

  if (String(turn.intent).startsWith('agent_fallback')) add('claude_failed', turn.intent)
  if (!reply.trim()) add('empty_reply', '')
  if (reply.length > 4000) add('too_long', `${reply.length} chars (WhatsApp cuts at 4096)`)
  if (GAVE_UP.test(reply)) add('gave_up', reply.match(GAVE_UP)[0])
  if (OLD_HELP.test(reply)) add('help_menu', 'answered with the old help menu')

  // Commits only on a bare yes.
  const commits = turn.writes.filter(w => RECORD_TABLES.has(w.table))
  if (commits.length && bare !== 'confirm') add('commit_without_yes', commits.map(w => `${w.op} ${w.table}`).join(', '))
  if (bare === 'confirm' && turn.hadPending && !commits.length && !/sent|cancel/i.test(reply)) add('yes_saved_nothing', reply.slice(0, 120))

  // "Saved" only when something was.
  if (!commits.length && CLAIMS_SAVED.test(reply) && !NEGATED.test(reply) && bare !== 'confirm') {
    const sentence = reply.split(/(?<=[.!\n])/).find(s => CLAIMS_SAVED.test(s) && !NEGATED.test(s))
    if (sentence && /\b(I'?ve|I have|has been|have been|is now|are now|✅)\b/i.test(sentence)) add('claims_saved_without_save', sentence.trim().slice(0, 160))
  }

  // Every listing it names is real, and what it says about it is true.
  const listings = new Map(ctx.db.table('Properties').map(p => [Number(p.id), listingFacts(p)]))
  for (const line of reply.split('\n')) {
    for (const m of line.matchAll(/#(\d{1,6})\b/g)) {
      const id = Number(m[1])
      const facts = listings.get(id)
      const isClient = ctx.db.table('client_requests').some(c => Number(c.id) === id)
      if (!facts) { if (!isClient) add('invented_id', `#${id}: ${line.trim().slice(0, 120)}`); continue }
      // Only the text about THIS listing: up to the next #id on the line.
      const tail = line.slice(m.index).split(/(?=#\d)/)[0]
      const amounts = amountsIn(tail)
      if (amounts.length && facts.prices.length && !amounts.some(a => facts.prices.some(p => Math.abs(a - p) <= Math.max(1, p * 0.01)))) {
        add('wrong_price', `#${id} said ${amounts.join('/')} but is ${facts.prices.join(' or ')}: ${tail.trim().slice(0, 120)}`)
      }
      const beds = tail.match(/(\d+)\s?-?\s?(?:bed(?:room)?s?|br|bd)\b/i)
      if (beds && facts.beds != null && Number(beds[1]) !== facts.beds) add('wrong_beds', `#${id} said ${beds[1]} bed, is ${facts.beds}: ${tail.trim().slice(0, 120)}`)
      if (/\/\s?mo|per month|monthly/i.test(tail) && facts.tx === 'For Sale') add('wrong_transaction', `#${id} shown as rent but is For Sale`)
      if (/for sale/i.test(tail) && facts.tx === 'For Rent') add('wrong_transaction', `#${id} shown as for sale but is For Rent`)
    }
  }

  // An agent never sees another agent's client's phone.
  if (ctx.profile.role === 'agent') {
    const replyDigits = digits(reply)
    for (const c of ctx.db.table('client_requests')) {
      const owner = ownerOf(c)
      const phone = digits(c['client phone'])
      if (owner && owner !== ctx.profile.agent_code && phone.length >= 7 && replyDigits.includes(phone.slice(-7))) {
        add('privacy_leak', `phone of client #${c.id} (agent ${owner})`)
      }
    }
  }

  // Blocked network calls are recorded on the turn as effects (a notification
  // production would have sent), not problems.
  return problems
}
