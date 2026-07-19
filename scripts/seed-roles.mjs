/**
 * Create/refresh the manager + agent test logins and their Profiles.
 *
 * Usage:  node scripts/seed-roles.mjs
 *
 *   manager@stategen.app / ManagerPass123!  → role 'owner'  (sees everything)
 *   agent@stategen.app   / AgentPass123!    → role 'agent', agent_code 'a2'
 *                                             (Rami Saad — owns the a2 records)
 *
 * The pre-existing test@stategen.app stays a manager so older instructions
 * keep working. Uses the service-role key (bypasses RLS).
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

const ACCOUNTS = [
  { email: 'manager@stategen.app', password: 'ManagerPass123!', name: 'Maya Mansour (Manager)', role: 'owner', agentCode: null },
  { email: 'agent@stategen.app',   password: 'AgentPass123!',   name: 'Rami Saad (Agent)',      role: 'agent', agentCode: 'a2' },
]

async function upsertUser({ email, password }) {
  const { data: created, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (!error) return created.user.id
  if (!/already|registered|exists/i.test(error.message)) throw error
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const existing = list.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!existing) throw new Error(`${email} reported existing but not found`)
  await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
  return existing.id
}

for (const acct of ACCOUNTS) {
  const userId = await upsertUser(acct)

  const row = {
    id: userId,
    company_id: COMPANY_ID,
    Full_name: acct.name,
    role: acct.role,
    agent_code: acct.agentCode,
  }

  const { data: existing } = await supabase.from('Profiles').select('id').eq('id', userId).maybeSingle()
  const { error } = existing
    ? await supabase.from('Profiles').update(row).eq('id', userId)
    : await supabase.from('Profiles').insert(row)
  if (error) throw error

  console.log(`✓ ${acct.email.padEnd(24)} role=${acct.role.padEnd(6)} agent_code=${acct.agentCode ?? '—'}`)
}

// Keep the original seeded login working as a manager.
const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
const legacy = list.users.find(u => u.email === 'test@stategen.app')
if (legacy) {
  await supabase.from('Profiles').update({ role: 'owner', agent_code: null }).eq('id', legacy.id)
  console.log('✓ test@stategen.app       role=owner  (unchanged manager)')
}

console.log('\nLogins ready:')
for (const a of ACCOUNTS) console.log(`  ${a.email}  /  ${a.password}`)
