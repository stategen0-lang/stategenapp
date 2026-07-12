/**
 * Seed a few sample properties and client requests for the test company,
 * so a freshly signed-in account has content to explore.
 *
 * Usage:  node scripts/seed-demo-data.mjs [companyId]   (default company 1)
 * Idempotent: skips seeding if the company already has properties.
 * Uses the service-role key (bypasses RLS).
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

const { count } = await supabase
  .from('Properties')
  .select('id', { count: 'exact', head: true })
  .eq('company_id', COMPANY_ID)

if (count && count > 0) {
  console.log(`Company ${COMPANY_ID} already has ${count} properties — skipping to avoid duplicates.`)
  process.exit(0)
}

const properties = [
  { Title: 'Raouché Apartment',   Location: 'Beirut', Neighborhood: 'Raouché',   Price: 480000,  Currency: 'USD', Bedrooms: 3, bathrooms: 2, size: 145, Payment_terms: 'sale', Status: 'Available' },
  { Title: 'Achrafieh Penthouse', Location: 'Beirut', Neighborhood: 'Achrafieh', Price: 980000,  Currency: 'USD', Bedrooms: 4, bathrooms: 3, size: 220, Payment_terms: 'sale', Status: 'Available' },
  { Title: 'Dbayeh Villa',        Location: 'Metn',   Neighborhood: 'Dbayeh',    Price: 1200000, Currency: 'USD', Bedrooms: 5, bathrooms: 4, size: 450, Payment_terms: 'sale', Status: 'Reserved'  },
  { Title: 'Hamra Studio',        Location: 'Beirut', Neighborhood: 'Hamra',     Price: 220000,  Currency: 'USD', Bedrooms: 1, bathrooms: 1, size: 65,  Payment_terms: 'sale', Status: 'Available' },
  { Title: 'Broumana Villa',      Location: 'Metn',   Neighborhood: 'Broumana',  Price: 2100000, Currency: 'USD', Bedrooms: 6, bathrooms: 5, size: 650, Payment_terms: 'sale', Status: 'Available' },
].map((p) => ({ company_id: COMPANY_ID, ...p }))

const clients = [
  { 'Client Name': 'Sara Stephan',  'client phone': '+9613111222', budget_min: 400000, budget_max: 550000,  'prefered-location': 'Beirut',    bedrooms: 3, payment_terms: 'sale', status: 'active', notes: 'Prefers sea view, flexible on floor.' },
  { 'Client Name': 'Michel Tanios', 'client phone': '+9613333444', budget_min: 900000, budget_max: 1300000, 'prefered-location': 'Achrafieh', bedrooms: 4, payment_terms: 'sale', status: 'active', notes: 'Wants parking + modern finishing.' },
  { 'Client Name': 'Nour Haddad',   'client phone': '+9613555666', budget_min: 180000, budget_max: 260000,  'prefered-location': 'Hamra',     bedrooms: 1, payment_terms: 'sale', status: 'active', notes: 'First-time buyer, needs financing help.' },
].map((c) => ({ company_id: COMPANY_ID, ...c }))

const { data: insProps, error: pErr } = await supabase.from('Properties').insert(properties).select('id')
if (pErr) throw pErr
console.log(`✓ Inserted ${insProps.length} properties`)

const { data: insClients, error: cErr } = await supabase.from('client_requests').insert(clients).select('id')
if (cErr) throw cErr
console.log(`✓ Inserted ${insClients.length} client requests`)

console.log('\nDemo data ready for company', COMPANY_ID)
