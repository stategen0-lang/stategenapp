/**
 * Seed a test account directly in Supabase — bypasses Stripe/payment.
 * Creates (or updates) an auth user with a confirmed email, plus the
 * Company + Profile rows the app expects, so you can sign in and test.
 *
 * Usage:
 *   node scripts/seed-test-user.mjs [email] [password]
 * Defaults: test@stategen.app / TestPass123!
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// --- load .env.local ---
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const EMAIL = process.argv[2] || 'test@stategen.app'
const PASSWORD = process.argv[3] || 'TestPass123!'

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1. Create the auth user (or update if it already exists), email pre-confirmed.
let userId
const { data: created, error: cErr } = await supabase.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
})

if (cErr) {
  if (/already|registered|exists/i.test(cErr.message)) {
    const { data: list, error: lErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (lErr) throw lErr
    const existing = list.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase())
    if (!existing) throw new Error(`User ${EMAIL} reported as existing but not found in list.`)
    userId = existing.id
    const { error: uErr } = await supabase.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
    })
    if (uErr) throw uErr
    console.log(`↻ Reset password for existing user ${EMAIL}`)
  } else {
    throw cErr
  }
} else {
  userId = created.user.id
  console.log(`✓ Created auth user ${EMAIL}`)
}

// 2. Ensure a Company exists (check-then-insert; no unique constraint on domain).
const DOMAIN = 'test.stategen.app'
let company
const { data: existingCo, error: findCoErr } = await supabase
  .from('Companies')
  .select('*')
  .eq('domain', DOMAIN)
  .limit(1)
  .maybeSingle()
if (findCoErr) throw findCoErr

if (existingCo) {
  company = existingCo
  console.log(`✓ Company already exists (id ${company.id})`)
} else {
  const { data: newCo, error: coErr } = await supabase
    .from('Companies')
    .insert({ Name: 'Test Agency', domain: DOMAIN, Plan: 'pro', 'is active': true })
    .select()
    .single()
  if (coErr) throw coErr
  company = newCo
  console.log(`✓ Company created (id ${company.id})`)
}

// 3. Ensure a Profile links the user to the company as owner (id is the PK).
const { data: existingProfile, error: findPErr } = await supabase
  .from('Profiles')
  .select('id')
  .eq('id', userId)
  .maybeSingle()
if (findPErr) throw findPErr

if (existingProfile) {
  const { error: upErr } = await supabase
    .from('Profiles')
    .update({ company_id: company.id, Full_name: 'Test Manager', role: 'owner' })
    .eq('id', userId)
  if (upErr) throw upErr
  console.log(`✓ Profile updated (owner)`)
} else {
  const { error: insErr } = await supabase
    .from('Profiles')
    .insert({ id: userId, company_id: company.id, Full_name: 'Test Manager', role: 'owner' })
  if (insErr) throw insErr
  console.log(`✓ Profile created (owner)`)
}

console.log('\n────────────────────────────────')
console.log('  Test account ready — sign in with:')
console.log(`  Email:    ${EMAIL}`)
console.log(`  Password: ${PASSWORD}`)
console.log('────────────────────────────────')
