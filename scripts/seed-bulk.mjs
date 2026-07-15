/**
 * Seed the database with realistic bulk test data for matching:
 *   50 properties + 50 client requests, for company 1.
 *
 * Usage:  node scripts/seed-bulk.mjs [companyId]     (default 1)
 * Uses the service-role key (bypasses RLS). Non-destructive — appends.
 *
 * Mirrors the shapes the app reads:
 *  - Properties.Amenities = JSON of the "extra" fields (type, transaction,
 *    garden, balcony, view, rent, agentId, parkings, status).
 *  - client_requests.notes = JSON { email, type, agentId, req:{ type } };
 *    Agent_id stays null (it's a uuid column, not the mock 'a1' code).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const COMPANY_ID = Number(process.argv[2] || 1)

// ── helpers ──────────────────────────────────────────────────────────────────
const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a
const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)]
const chance = (p) => Math.random() < p
const round = (n, step) => Math.round(n / step) * step

// [neighbourhood, city] — neighbourhoods are recognised by the location scorer.
const AREAS = [
  ['Hamra', 'Beirut'], ['Achrafieh', 'Beirut'], ['Verdun', 'Beirut'], ['Gemmayzeh', 'Beirut'],
  ['Badaro', 'Beirut'], ['Mar Mikhael', 'Beirut'], ['Sodeco', 'Beirut'], ['Raouché', 'Beirut'], ['Sin el Fil', 'Beirut'],
  ['Dbayeh', 'Metn'], ['Antelias', 'Metn'], ['Zalka', 'Metn'], ['Jal el Dib', 'Metn'], ['Beit Mery', 'Metn'],
  ['Broumana', 'Metn'], ['Rabieh', 'Metn'], ['Baabda', 'Metn'], ['Mansourieh', 'Metn'], ['Biyada', 'Metn'],
  ['Jounieh', 'Keserwan'], ['Kaslik', 'Keserwan'], ['Ghazir', 'Keserwan'], ['Zouk', 'Keserwan'], ['Adma', 'Keserwan'], ['Jbeil', 'Keserwan'],
  ['Aley', 'Chouf'], ['Bhamdoun', 'Chouf'], ['Damour', 'Chouf'],
  ['Batroun', 'North'], ['Koura', 'North'], ['Saida', 'South'], ['Tyre', 'South'],
]

const FIRST = ['Karim', 'Rana', 'Elie', 'Maya', 'Ziad', 'Nadine', 'Marc', 'Lea', 'Georges', 'Yara',
  'Fadi', 'Rita', 'Tarek', 'Carla', 'Sami', 'Diala', 'Joe', 'Nour', 'Rami', 'Maria', 'Hadi', 'Lynn',
  'Bassam', 'Sara', 'Chady', 'Nay', 'Wael', 'Perla', 'Antoine', 'Grace', 'Karl', 'Christelle', 'Elias',
  'Reem', 'Roy', 'Dana', 'Michel', 'Layal', 'Nabil', 'Joelle']
const LAST = ['Khoury', 'Haddad', 'Saad', 'Aoun', 'Gemayel', 'Nassar', 'Fares', 'Rizk', 'Tannous',
  'Abou Khalil', 'Chidiac', 'Karam', 'Sleiman', 'Nakhle', 'Ghanem', 'Daher', 'Semaan', 'Younes',
  'Bou Assi', 'Frangieh', 'Merhi', 'Zeaiter', 'Hage', 'Bitar']

const AGENTS = ['a1', 'a2', 'a3', 'a4']
const VIEWS = ['Sea', 'Mountain', 'City', 'Open', 'Valley', 'Street', '']
const TYPE_LABEL = { Appartement: 'Apartment', Villa: 'Villa', Office: 'Office', Shop: 'Shop', Building: 'Building', Showroom: 'Showroom', Land: 'Plot', Restaurant: 'Restaurant' }
const RESIDENTIAL = new Set(['Appartement', 'Villa'])

function weightedType() {
  const r = Math.random() * 100
  if (r < 45) return 'Appartement'
  if (r < 60) return 'Villa'
  if (r < 72) return 'Office'
  if (r < 82) return 'Shop'
  if (r < 90) return 'Building'
  if (r < 95) return 'Showroom'
  if (r < 98) return 'Land'
  return 'Restaurant'
}

function salePrice(type) {
  switch (type) {
    case 'Villa':      return round(rand(700, 3000) * 1000, 25000)
    case 'Building':   return round(rand(600, 2500) * 1000, 25000)
    case 'Office':     return round(rand(200, 1200) * 1000, 10000)
    case 'Land':       return round(rand(200, 1500) * 1000, 25000)
    case 'Showroom':   return round(rand(250, 900) * 1000, 10000)
    case 'Shop':       return round(rand(120, 700) * 1000, 5000)
    case 'Restaurant': return round(rand(200, 800) * 1000, 10000)
    default:           return round(rand(150, 1200) * 1000, 5000) // Appartement
  }
}
function monthlyRent(type) {
  switch (type) {
    case 'Villa':   return round(rand(2500, 8000), 100)
    case 'Office':  return round(rand(1200, 5000), 100)
    case 'Shop':    return round(rand(800, 4000), 100)
    default:        return round(rand(600, 3500), 50) // Appartement
  }
}

// ── generate 50 properties ───────────────────────────────────────────────────
const properties = Array.from({ length: 50 }, () => {
  const [nb, city] = pick(AREAS)
  const type = weightedType()
  const canRent = RESIDENTIAL.has(type) || type === 'Office' || type === 'Shop'
  const isRent = canRent && chance(0.3)
  const beds = RESIDENTIAL.has(type) ? (type === 'Villa' ? rand(4, 7) : rand(1, 4)) : 0
  const baths = beds > 0 ? rand(Math.max(1, beds - 1), beds) : rand(1, 3)
  const size = type === 'Villa' ? rand(300, 800) : type === 'Land' ? rand(400, 2000)
    : type === 'Building' ? rand(250, 900) : RESIDENTIAL.has(type) ? rand(60, 300) : rand(80, 400)
  const status = (() => { const r = Math.random(); return r < 0.65 ? 'Available' : r < 0.78 ? 'Reserved' : r < 0.9 ? 'Pending' : 'Sold' })()
  const rent = isRent ? monthlyRent(type) : 0
  const extras = {
    type,
    transaction: isRent ? 'For Rent' : 'For Sale',
    garden: (type === 'Villa' || type === 'Building') ? chance(0.7) : chance(0.2),
    balcony: RESIDENTIAL.has(type) ? chance(0.75) : chance(0.2),
    view: pick(VIEWS),
    rent,
    agentId: pick(AGENTS),
    parkings: rand(0, 3),
    status,
  }
  return {
    company_id: COMPANY_ID,
    Title: `${nb} ${TYPE_LABEL[type]}`,
    Location: city,
    Neighborhood: nb,
    Price: isRent ? 0 : salePrice(type),
    Currency: 'USD',
    Bedrooms: beds,
    bathrooms: baths,
    size,
    Payment_terms: extras.transaction,
    Amenities: JSON.stringify(extras),
    Photos: null,
    Status: status,
  }
})

// ── generate 50 clients ──────────────────────────────────────────────────────
const clients = Array.from({ length: 50 }, () => {
  const name = `${pick(FIRST)} ${pick(LAST)}`
  const isRenter = chance(0.25)
  const [nb, city] = pick(AREAS)
  const prefLoc = chance(0.6) ? nb : city
  const wantType = (() => { const r = Math.random(); return r < 0.25 ? '' : r < 0.6 ? 'Appartement' : r < 0.75 ? 'Villa' : r < 0.87 ? 'Office' : 'Shop' })()
  const beds = (wantType === 'Office' || wantType === 'Shop') ? rand(0, 2) : rand(1, 5)

  let budgetMin, budgetMax
  if (isRenter) {                       // annualised so it compares to rent×12
    const monthly = rand(700, 4000)
    budgetMin = round(monthly * 12 * 0.85, 1000)
    budgetMax = round(monthly * 12 * 1.2, 1000)
  } else {
    budgetMin = round(rand(150, 900) * 1000, 25000)
    budgetMax = budgetMin + round(rand(100, 600) * 1000, 25000)
  }

  const agentId = pick(AGENTS)
  const first = name.split(' ')[0].toLowerCase()
  const notes = {
    email: `${first}.${rand(10, 99)}@example.com`,
    type: isRenter ? 'Renter' : 'Buyer',
    agentId,
    req: { type: wantType },
  }
  return {
    company_id: COMPANY_ID,
    Agent_id: null,
    'Client Name': name,
    'client phone': `+961 ${pick(['3', '70', '71', '76', '78', '81'])} ${rand(100, 999)} ${rand(100, 999)}`,
    budget_min: budgetMin,
    budget_max: budgetMax,
    'prefered-location': prefLoc,
    bedrooms: beds,
    payment_terms: isRenter ? 'For Rent' : 'For Sale',
    notes: JSON.stringify(notes),
    status: (() => { const r = Math.random(); return r < 0.5 ? 'Searching' : r < 0.75 ? 'Viewing' : r < 0.9 ? 'Negotiation' : 'Signed' })(),
  }
})

// ── insert ───────────────────────────────────────────────────────────────────
const { data: pRows, error: pErr } = await supabase.from('Properties').insert(properties).select('id')
if (pErr) throw pErr
console.log(`✓ Inserted ${pRows.length} properties`)

const { data: cRows, error: cErr } = await supabase.from('client_requests').insert(clients).select('id')
if (cErr) throw cErr
console.log(`✓ Inserted ${cRows.length} client requests`)

// ── verify ───────────────────────────────────────────────────────────────────
const pc = await supabase.from('Properties').select('id', { count: 'exact', head: true }).eq('company_id', COMPANY_ID)
const cc = await supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('company_id', COMPANY_ID)
console.log(`\nCompany ${COMPANY_ID} totals now — properties: ${pc.count}, clients: ${cc.count}`)
