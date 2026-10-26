// Goals for simulated agents, built from the agency's real data, each with a
// check of the database afterwards. A goal that changes data is only met when
// exactly the right record ended up with exactly the right value — what the
// bot said along the way doesn't count.

const FIRST = ['Rita', 'Karim', 'Nadine', 'Elie', 'Maya', 'Tony', 'Hiba', 'Fadi', 'Lara', 'Georges', 'Rana', 'Ziad', 'Joelle', 'Sami', 'Carla', 'Walid', 'Mira', 'Jad', 'Yara', 'Charbel']
const LAST = ['Khoury', 'Haddad', 'Nassar', 'Saliba', 'Aoun', 'Gemayel', 'Frem', 'Moussa', 'Chidiac', 'Rizk', 'Daher', 'Karam', 'Hayek', 'Abi Nader', 'Sfeir']
const TYPES = ['apartment', 'villa', 'duplex', 'studio', 'office', 'shop', 'chalet', 'land']
const STATUSES = ['Viewing', 'Negotiating', 'Closed', 'Inactive']

export function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}
const pick = (r, a) => a[Math.floor(r() * a.length)]
const digits = s => String(s ?? '').replace(/\D/g, '')
const json = v => { try { return typeof v === 'string' ? JSON.parse(v || '{}') : (v ?? {}) } catch { return {} } }
// Area names compared loosely: accents dropped, sh/ch, ou/u and doubled letters
// folded, so the bot's standard spelling (Achrafieh) satisfies the agent's (Ashrafieh).
const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/sh/g, 'ch').replace(/ou/g, 'u').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1')
const sameArea = (haystack, area) => fold(haystack).includes(fold(String(area).split(' ')[0]))
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= Math.max(1, Number(b) * 0.001)
const money = n => n >= 1000 && n % 1000 === 0 && n < 1_000_000 ? `${n / 1000}k` : String(n)

function phone(r) {
  const prefix = pick(r, ['70', '71', '76', '78', '79', '81', '03'])
  return `${prefix} ${String(Math.floor(r() * 900) + 100)} ${String(Math.floor(r() * 900) + 100)}`
}

/** Areas the agency actually uses. */
function areasOf(snapshot) {
  const set = new Set()
  for (const p of snapshot.Properties) for (const a of [p.Neighborhood, p.Location]) if (a && a.length > 2 && a !== 'Beirut') set.add(a.trim())
  return [...set]
}

function owned(rows, profile, agentOf) {
  if (profile.role !== 'agent') return rows
  return rows.filter(r => agentOf(r) === profile.agent_code)
}
const clientAgent = c => json(c.notes).agentId ?? null
const listingAgent = p => json(p.Amenities).agentId ?? null

/** A client the agent can edit and name unambiguously. */
function editableClient(r, snapshot, profile) {
  const names = new Map()
  for (const c of snapshot.client_requests) names.set(c['Client Name'], (names.get(c['Client Name']) ?? 0) + 1)
  // Unique even as a search: "Rana" also finds "Rana Haddad".
  const all = snapshot.client_requests.map(c => String(c['Client Name'] ?? '').toLowerCase())
  const unique = name => all.filter(n => n.includes(String(name).toLowerCase())).length === 1
  const list = owned(snapshot.client_requests, profile, clientAgent).filter(c => c['Client Name'] && names.get(c['Client Name']) === 1 && unique(c['Client Name'])
    && !/(apartment|villa|studio|duplex|office|shop|land|chalet|furnished|unfurnished)/i.test(c['Client Name']))
  return list.length ? pick(r, list) : null
}

function editableClientsWithDeal(snapshot, profile) {
  const deals = new Map(snapshot.deals.map(d => [Number(d.client_id), d]))
  const names = new Map()
  for (const c of snapshot.client_requests) names.set(c['Client Name'], (names.get(c['Client Name']) ?? 0) + 1)
  return owned(snapshot.client_requests, profile, clientAgent)
    .filter(c => c['Client Name'] && names.get(c['Client Name']) === 1 && deals.has(Number(c.id)) && !deals.get(Number(c.id)).outcome)
    .map(c => ({ client: c, deal: deals.get(Number(c.id)) }))
}

/** Does the text state this amount, in any of the usual ways ($1,200 · 1200 · 1.2k · $350k · 1.2M)? */
function amountsMention(text, n) {
  const forms = new Set([String(n), n.toLocaleString('en-US')])
  if (n >= 1000) { forms.add(`${n / 1000}k`); forms.add(`${n / 1000}K`) }
  if (n >= 1_000_000) { forms.add(`${n / 1_000_000}M`); forms.add(`${n / 1_000_000}m`); forms.add(`${n / 1_000_000} million`) }
  return [...forms].some(f => text.includes(f))
}

const clientRow = (db, id) => db.table('client_requests').find(c => Number(c.id) === Number(id))
const listingRow = (db, id) => db.table('Properties').find(p => Number(p.id) === Number(id))

export const GOAL_KINDS = {
  update_budget(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    const budget = pick(r, [800, 1200, 1500, 2000, 150000, 250000, 400000, 650000])
    return {
      writes: true,
      goal: `Change the budget of your client ${c['Client Name']} to $${money(budget)}.`,
      verify: db => {
        const row = clientRow(db, c.id)
        return near(row?.budget_max, budget) || near(row?.budget_min, budget) ? null : `budget is ${row?.budget_min}/${row?.budget_max}, wanted ${budget}`
      },
    }
  },

  update_status(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    const status = pick(r, STATUSES.filter(x => x !== c.status))
    return {
      writes: true,
      goal: `Your client ${c['Client Name']} is now at the "${status}" stage — update their status.`,
      verify: db => String(clientRow(db, c.id)?.status ?? '').toLowerCase() === status.toLowerCase() ? null : `status is ${clientRow(db, c.id)?.status}, wanted ${status}`,
    }
  },

  update_client_beds(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    const beds = pick(r, [1, 2, 3, 4].filter(b => b !== Number(c.bedrooms)))
    return {
      writes: true,
      goal: `Your client ${c['Client Name']} now wants ${beds} bedrooms instead — update that.`,
      verify: db => Number(clientRow(db, c.id)?.bedrooms) === beds ? null : `bedrooms is ${clientRow(db, c.id)?.bedrooms}, wanted ${beds}`,
    }
  },

  add_client(r, s, profile) {
    // A manager's new client has to go to an agent.
    const assign = profile.role === 'agent' ? null : s.Profiles.find(p => p.role === 'agent')
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`
    const tel = phone(r)
    const renter = r() < 0.5
    const area = pick(r, areasOf(s))
    const beds = pick(r, [1, 2, 3])
    const budget = renter ? pick(r, [700, 900, 1200, 1800]) : pick(r, [120000, 200000, 350000, 500000])
    return {
      writes: true,
      goal: `Add a new client: ${name}, phone ${tel}, wants to ${renter ? 'rent' : 'buy'} a ${beds}-bedroom apartment in ${area}, budget $${money(budget)}${renter ? ' a month' : ''}.${assign ? ` Assign them to your agent ${assign.Full_name}.` : ''}`,
      verify: db => {
        const before = new Set(s.client_requests.map(c => Number(c.id)))
        const added = db.table('client_requests').filter(c => !before.has(Number(c.id)))
        if (added.length !== 1) return `${added.length} clients added, wanted 1`
        const c = added[0], bad = []
        if (String(c['Client Name']).toLowerCase() !== name.toLowerCase()) bad.push(`name "${c['Client Name']}"`)
        if (!digits(c['client phone']).endsWith(digits(tel).slice(-7))) bad.push(`phone "${c['client phone']}"`)
        if (!near(c.budget_max, budget) && !near(c.budget_min, budget)) bad.push(`budget ${c.budget_min}/${c.budget_max}`)
        if (!sameArea(c['prefered-location'], area)) bad.push(`area "${c['prefered-location']}"`)
        if (Number(c.bedrooms) !== beds) bad.push(`beds ${c.bedrooms}`)
        const type = json(c.notes).clientType ?? json(c.notes).type ?? ''
        if (type && !String(type).toLowerCase().startsWith(renter ? 'rent' : 'buy')) bad.push(`type ${type}`)
        if (assign && json(c.notes).agentId !== assign.agent_code) bad.push(`assigned to ${json(c.notes).agentId}, wanted ${assign.agent_code}`)
        return bad.length ? `wrong fields: ${bad.join(', ')}` : null
      },
    }
  },

  add_listing(r, s) {
    const type = pick(r, TYPES.slice(0, 5))
    const area = pick(r, areasOf(s))
    const rent = r() < 0.4
    const price = rent ? pick(r, [600, 900, 1400, 2200]) : pick(r, [95000, 180000, 320000, 750000])
    const beds = type === 'studio' || type === 'office' ? 0 : pick(r, [1, 2, 3, 4])
    const owner = `${pick(r, FIRST)} ${pick(r, LAST)}`
    const tel = phone(r)
    return {
      writes: true,
      goal: `Add a new listing: ${beds ? `${beds}-bedroom ` : ''}${type} for ${rent ? 'rent' : 'sale'} in ${area}, ${rent ? `$${price} a month` : `$${money(price)}`}. Owner: ${owner}, ${tel}.`,
      verify: db => {
        const before = new Set(s.Properties.map(p => Number(p.id)))
        const added = db.table('Properties').filter(p => !before.has(Number(p.id)))
        if (added.length !== 1) return `${added.length} listings added, wanted 1`
        const p = added[0], a = json(p.Amenities), bad = []
        if (!near(p.Price, price) && !near(a.rent, price)) bad.push(`price ${p.Price}/rent ${a.rent}`)
        if (beds && Number(p.Bedrooms) !== beds) bad.push(`beds ${p.Bedrooms}`)
        if (a.transaction !== (rent ? 'For Rent' : 'For Sale')) bad.push(`transaction ${a.transaction}`)
        const where = `${p.Location} ${p.Neighborhood} ${p.Title}`.toLowerCase()
        if (!sameArea(where, area)) bad.push(`area "${p.Location}/${p.Neighborhood}"`)
        return bad.length ? `wrong fields: ${bad.join(', ')}` : null
      },
    }
  },

  update_listing_price(r, s, profile) {
    const list = owned(s.Properties, profile, listingAgent); if (!list.length) return null
    const p = pick(r, list)
    const isRent = json(p.Amenities).transaction === 'For Rent'
    const price = isRent ? pick(r, [700, 1100, 1600, 2500]) : pick(r, [110000, 240000, 420000, 900000])
    return {
      writes: true,
      goal: `The owner changed the price of listing #${p.id} (${p.Title}) — make it ${isRent ? `$${price} a month` : `$${money(price)}`}.`,
      verify: db => {
        const row = listingRow(db, p.id), a = json(row?.Amenities)
        return near(row?.Price, price) || near(a.rent, price) ? null : `price ${row?.Price}/rent ${a.rent}, wanted ${price}`
      },
    }
  },

  update_listing_status(r, s, profile) {
    const list = owned(s.Properties, profile, listingAgent); if (!list.length) return null
    const p = pick(r, list)
    const isRent = json(p.Amenities).transaction === 'For Rent'
    const status = isRent ? 'Rented' : 'Sold'
    return {
      writes: true,
      goal: `Listing #${p.id} (${p.Title}) was just ${status.toLowerCase()} — mark it.`,
      verify: db => {
        const row = listingRow(db, p.id)
        const now = `${row?.Status ?? ''} ${json(row?.Amenities).status ?? ''}`
        return now.toLowerCase().includes(status.toLowerCase()) ? null : `status "${now.trim()}", wanted ${status}`
      },
    }
  },

  correct_before_saving(r, s) {
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`
    const tel = phone(r)
    const area = pick(r, areasOf(s))
    const first = pick(r, [800, 1000]), fixed = first + 300
    return {
      writes: true,
      goal: `Add a new client ${name}, phone ${tel}, renter looking for an apartment in ${area}, budget $${first} a month. BUT when the assistant shows you the summary to confirm, don't confirm yet — tell it the budget is actually $${fixed}, then confirm the corrected version.`,
      verify: db => {
        const before = new Set(s.client_requests.map(c => Number(c.id)))
        const added = db.table('client_requests').filter(c => !before.has(Number(c.id)))
        if (added.length !== 1) return `${added.length} clients added, wanted 1`
        return near(added[0].budget_max, fixed) || near(added[0].budget_min, fixed) ? null : `budget ${added[0].budget_min}/${added[0].budget_max}, wanted ${fixed}`
      },
    }
  },

  cancel(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    return {
      writes: true,
      goal: `Ask to change ${c['Client Name']}'s budget to $${money(pick(r, [999, 123000]))}. When the assistant asks you to confirm, change your mind and cancel it (say no). Once it says it's cancelled, you're done.`,
      verify: db => {
        const before = s.client_requests.find(x => x.id === c.id), now = clientRow(db, c.id)
        return before.budget_max === now?.budget_max && before.budget_min === now?.budget_min ? null : 'budget changed although cancelled'
      },
    }
  },

  other_agents_client(r, s, profile) {
    if (profile.role !== 'agent') return null
    const theirs = s.client_requests.filter(c => clientAgent(c) && clientAgent(c) !== profile.agent_code && c['Client Name'])
    if (!theirs.length) return null
    const c = pick(r, theirs)
    return {
      writes: true,
      goal: `Try to change the budget of client ${c['Client Name']} to $${money(pick(r, [500, 300000]))}. (They may belong to another agent — if the assistant says it can't, accept that and reply DONE.)`,
      verify: db => {
        const before = s.client_requests.find(x => x.id === c.id), now = clientRow(db, c.id)
        return before.budget_max === now?.budget_max ? null : "changed another agent's client"
      },
    }
  },

  // ── Through the old router's bridge (other_request) ───────────────────────

  deal_move(r, s, profile) {
    const withDeal = editableClientsWithDeal(s, profile)
    if (!withDeal.length) return null
    const { client, deal } = pick(r, withDeal)
    const stage = pick(r, ['contacted', 'viewing', 'negotiating'].filter(x => x !== deal.stage))
    return {
      writes: true,
      goal: `Move your client ${client['Client Name']}'s deal to the "${stage}" stage in the pipeline.`,
      verify: db => {
        const now = db.table('deals').find(d => d.id === deal.id)
        return now?.stage === stage ? null : `deal stage is ${now?.stage}, wanted ${stage}`
      },
    }
  },

  book_viewing(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    const p = pick(r, s.Properties)
    const when = pick(r, ['tomorrow at 4pm', 'next Monday at 11am', 'Thursday at 6pm'])
    return {
      writes: true,
      goal: `Book a viewing with your client ${c['Client Name']} for listing #${p.id}, ${when}.`,
      verify: db => {
        const added = db.table('calendar_events').length - (s.calendar_events?.length ?? 0)
        return added === 1 ? null : `${added} events added, wanted 1`
      },
    }
  },

  send_to_marketing(r, s, profile) {
    const list = owned(s.Properties, profile, listingAgent); if (!list.length) return null
    const p = pick(r, list)
    return { writes: false, goal: `Send listing #${p.id} to the marketing team, and confirm when asked.` }
  },

  describe_listing(r, s, profile) {
    const list = owned(s.Properties, profile, listingAgent); if (!list.length) return null
    const p = pick(r, list)
    return { writes: false, goal: `Ask for a ready-to-post description for listing #${p.id}${r() < 0.3 ? ', in Arabic' : ''}.` }
  },

  // ── Managers ──────────────────────────────────────────────────────────────

  team_overview(r, s, profile) {
    if (profile.role === 'agent') return null
    return { writes: false, goal: pick(r, ['Ask how your agents are doing this week.', 'Ask what is new in the agency today.', 'Ask which follow-ups are overdue across the team.']) }
  },

  // ── More editing ──────────────────────────────────────────────────────────

  update_listing_details(r, s, profile) {
    const list = owned(s.Properties, profile, listingAgent).filter(p => p.Bedrooms != null)
    if (!list.length) return null
    const p = pick(r, list)
    const field = pick(r, ['beds', 'size', 'furnished'])
    if (field === 'beds') {
      const beds = pick(r, [1, 2, 3, 4].filter(b => b !== Number(p.Bedrooms)))
      return {
        writes: true, goal: `Listing #${p.id} (${p.Title}) actually has ${beds} bedrooms — fix it.`,
        verify: db => Number(listingRow(db, p.id)?.Bedrooms) === beds ? null : `Bedrooms ${listingRow(db, p.id)?.Bedrooms}, wanted ${beds}`,
      }
    }
    if (field === 'size') {
      const size = pick(r, [95, 140, 185, 230].filter(x => x !== Number(p.size)))
      return {
        writes: true, goal: `The size of listing #${p.id} (${p.Title}) is ${size} m², not what's on file — update it.`,
        verify: db => Number(listingRow(db, p.id)?.size) === size ? null : `size ${listingRow(db, p.id)?.size}, wanted ${size}`,
      }
    }
    return {
      writes: true, goal: `Listing #${p.id} (${p.Title}) is now fully furnished — update it.`,
      verify: db => /^furnished$/i.test(String(json(listingRow(db, p.id)?.Amenities).furnishing ?? '')) ? null : `furnishing "${json(listingRow(db, p.id)?.Amenities).furnishing}", wanted Furnished`,
    }
  },

  update_client_details(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    if (r() < 0.5) {
      const tel = phone(r)
      return {
        writes: true, goal: `Your client ${c['Client Name']} has a new phone number: ${tel}. Update it.`,
        verify: db => digits(clientRow(db, c.id)?.['client phone']).endsWith(digits(tel).slice(-7)) ? null : `phone "${clientRow(db, c.id)?.['client phone']}", wanted ${tel}`,
      }
    }
    const area = pick(r, areasOf(s))
    return {
      writes: true, goal: `Your client ${c['Client Name']} now wants to look in ${area} instead — change their area.`,
      verify: db => sameArea(clientRow(db, c.id)?.['prefered-location'], area) ? null : `area "${clientRow(db, c.id)?.['prefered-location']}", wanted ${area}`,
    }
  },

  // "send me Charbel Helou's request" — the most common lookup. The reply must
  // carry the client's real brief: checked against the record, not judged.
  client_request(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    const phrasing = pick(r, [
      `send me ${c['Client Name']}'s request`,
      `what is ${c['Client Name']} looking for`,
      `pull up ${c['Client Name']}`,
      `${c['Client Name']} request pls`,
      `remind me what ${c['Client Name']} wants and their budget`,
    ])
    const budget = Number(c.budget_max) || Number(c.budget_min) || 0
    const area = String(c['prefered-location'] ?? '').split(/[,/]/)[0].trim()
    return {
      writes: false,
      goal: `Ask the assistant, in roughly these words: "${phrasing}". You want their request (what they want, where, budget).`,
      checkReplies: (turns) => {
        const text = turns.map(t => t.reply).join('\n')
        const bad = []
        if (budget && !amountsMention(text, budget)) bad.push(`budget ${budget} not in the reply`)
        if (area && !text.toLowerCase().includes(area.toLowerCase())) bad.push(`area "${area}" not in the reply`)
        return bad.length ? bad.join('; ') : null
      },
    }
  },

  // ── Questions — checked by the literal checks and the judge ───────────────

  search(r, s) {
    const rent = r() < 0.5
    const area = pick(r, areasOf(s))
    const beds = pick(r, [null, 1, 2, 3])
    const cap = r() < 0.5 ? (rent ? pick(r, [1000, 2000]) : pick(r, [200000, 500000])) : null
    return {
      writes: false,
      goal: `Ask what listings the agency has: ${beds ? `${beds}-bedroom ` : ''}apartments for ${rent ? 'rent' : 'sale'} in ${area}${cap ? `, max $${money(cap)}${rent ? '/month' : ''}` : ''}. Read the answer.`,
    }
  },

  client_info(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    return { writes: false, goal: `Ask what your client ${c['Client Name']} is looking for and what their budget is.` }
  },

  listing_info(r, s) {
    const p = pick(r, s.Properties)
    return { writes: false, goal: `Ask for the details of listing #${p.id}.` }
  },

  matches_for_client(r, s, profile) {
    const c = editableClient(r, s, profile); if (!c) return null
    return { writes: false, goal: `Ask which listings would suit your client ${c['Client Name']}.` }
  },

  find_by_phone(r, s, profile) {
    const list = owned(s.client_requests, profile, clientAgent).filter(c => digits(c['client phone']).length >= 7)
    if (!list.length) return null
    const c = pick(r, list)
    return { writes: false, goal: `You have a number in your phone, ${c['client phone']}, and forgot whose it is. Ask the assistant which client it is.` }
  },

  small_talk(r) {
    return { writes: false, goal: pick(r, [
      'Say hi and ask what the assistant can do for you.',
      'Ask the assistant something unrelated to work, like a restaurant recommendation in Beirut, and see how it handles it.',
      'Thank the assistant for its help today.',
      'Ask how to add a listing with photos.',
    ]) }
  },
}

/**
 * How often each kind comes up, roughly as agents use the bot: adding clients
 * and listings, matching, editing, and pulling up a client's request dominate.
 * Kinds not listed (descriptions, marketing, manager overviews) appear once
 * per cycle.
 */
export const COMMON_WEIGHTS = {
  add_client: 4, add_listing: 4, matches_for_client: 4, client_request: 4,
  update_budget: 2, update_listing_price: 2, update_listing_status: 2, update_listing_details: 2, update_client_details: 2,
  update_status: 1, update_client_beds: 1, correct_before_saving: 2, cancel: 1, search: 2, listing_info: 1,
  find_by_phone: 1, other_agents_client: 1, deal_move: 1, book_viewing: 1, small_talk: 1,
  describe_listing: 0, send_to_marketing: 0, team_overview: 1,
}

/** n goals, cycling through the kinds (weighted, if given), deterministic for a seed. */
export function makeGoals(snapshot, profile, n, seed = 1, weights = null) {
  const r = rng(seed)
  const kinds = weights
    ? Object.keys(GOAL_KINDS).flatMap(k => Array(weights[k] ?? 1).fill(k))
    : Object.keys(GOAL_KINDS)
  const goals = []
  for (let i = 0; goals.length < n && i < n * 4; i++) {
    const kind = kinds[i % kinds.length]
    const g = GOAL_KINDS[kind](r, snapshot, profile)
    if (g) goals.push({ id: `${kind}-${goals.length + 1}`, kind, ...g })
  }
  return goals
}
