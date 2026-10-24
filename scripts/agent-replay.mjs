// Replay real WhatsApp messages through the new agent, side by side with what
// the old bot replied — so the agent can be judged on agents' actual phrasing
// before it is switched on for an agency.
//
//   node --env-file=.env.local --experimental-strip-types --import ./scripts/test-setup.mjs \
//        scripts/agent-replay.mjs --company 7 --days 30 --limit 25 --model claude-haiku-5-5 --yes
//
// SAFE BY CONSTRUCTION — it cannot change anything:
//   • Production is only ever read (select). The snapshot is loaded into the
//     in-memory fake database, and every tool runs against that.
//   • Writes therefore land in memory. Staging a change in the REAL
//     pending_actions would be dangerous: an agent's next "yes" would commit
//     something this script invented.
//   • The old router is never called (other_request is stubbed) — it can stage
//     too, and it calls Grok.
//   • "yes" / "no" replies are skipped: in production those are answered by
//     deterministic code before the agent runs.
//
// It DOES spend money on the Claude API (one turn per message), so it does
// nothing without --yes. The report contains clients' names and numbers: it is
// written outside the repo and must not be committed.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createClient } from '@supabase/supabase-js'
import { fakeDb } from '../src/lib/whatsapp/fake-db.mjs'
import { runAgentTurn } from '../src/lib/whatsapp/agent/loop.ts'
import { TOOLS, executeTool } from '../src/lib/whatsapp/agent/tools.ts'
import { SYSTEM_PROMPT, contextBlock } from '../src/lib/whatsapp/agent/prompt.ts'
import { toMessages, CONVERSATION_WINDOW_HOURS } from '../src/lib/whatsapp/agent/history.ts'
import { createCaller, claudeConfigured, agentModel } from '../src/lib/whatsapp/agent/client.ts'
// Agent-mode routing: only a BARE yes/no is answered by code; corrections such
// as 'yes but she is a renter' reach the agent and are replayed.
import { parseBareConfirmation as parseConfirmation } from '../src/lib/whatsapp/replies.ts'

// ── Arguments ───────────────────────────────────────────────────────────────
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const COMPANY = Number(arg('company', '0'))
const DAYS = Number(arg('days', '30'))
const LIMIT = Number(arg('limit', '25'))
const CONFIRMED = process.argv.includes('--yes')
const MODEL = agentModel(arg('model', process.env.WHATSAPP_AGENT_MODEL))
const OUT = arg('out', path.join(os.tmpdir(), `agent-replay-company-${COMPANY}-${MODEL}.html`))

if (!COMPANY) { console.error('usage: … scripts/agent-replay.mjs --company <id> [--days 30] [--limit 25] [--yes]'); process.exit(1) }
if (!claudeConfigured()) { console.error('No Anthropic credential (ANTHROPIC_API_KEY).'); process.exit(1) }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Supabase URL / service key missing from the environment.'); process.exit(1) }

// ── Snapshot (read-only) ────────────────────────────────────────────────────
const live = createClient(url, key, { auth: { persistSession: false } })
const read = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data ?? [] }

const [company] = await read(live.from('Companies').select('*').eq('id', COMPANY))
if (!company) { console.error(`No company ${COMPANY}.`); process.exit(1) }
const profiles = await read(live.from('Profiles').select('*').eq('company_id', COMPANY))
const properties = await read(live.from('Properties').select('*').eq('company_id', COMPANY))
const clients = await read(live.from('client_requests').select('*').eq('company_id', COMPANY))
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString()
const logs = await read(live.from('whatsapp_logs').select('*').eq('company_id', COMPANY).gt('created_at', since).order('created_at', { ascending: true }))

const byId = new Map(profiles.map(p => [p.id, p]))
// Every message from this agency's agents, oldest first, and what the old bot
// said back (the next outbound row on the same number).
const inbound = logs.filter(l => l.direction === 'inbound' && l.message?.trim() && byId.has(l.profile_id))
const replyAfter = (row) => logs.find(l => l.direction === 'outbound' && l.from_number === row.from_number && l.created_at >= row.created_at)
const skipped = inbound.filter(l => parseConfirmation(l.message) !== 'unknown')
const todo = inbound.filter(l => parseConfirmation(l.message) === 'unknown').slice(-LIMIT)

console.log(`${company.Name}: ${inbound.length} messages in ${DAYS} days — ${skipped.length} yes/no (answered by code, skipped), replaying the latest ${todo.length}.`)
console.log(`Model ${MODEL}, one turn each. Report → ${OUT}`)
if (!CONFIRMED) { console.log('\nNothing sent. Add --yes to run it (this calls the Claude API and costs money).'); process.exit(0) }

// ── Replay ──────────────────────────────────────────────────────────────────
const results = []
for (const [i, row] of todo.entries()) {
  const profile = byId.get(row.profile_id)
  // A fresh in-memory copy per message: what one turn stages must not leak
  // into the next.
  const db = fakeDb({
    Companies: [company], Profiles: profiles, Properties: properties, client_requests: clients,
    pending_actions: [], conversation_state: [], company_areas: [], listing_alerts: [], push_subscriptions: [],
  })
  const windowStart = new Date(new Date(row.created_at).getTime() - CONVERSATION_WINDOW_HOURS * 3_600_000).toISOString()
  const history = toMessages(logs.filter(l => l.from_number === row.from_number && l.created_at >= windowStart && l.created_at < row.created_at))
  const system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contextBlock({ name: profile.Full_name || 'the agent', role: profile.role, agentCode: profile.agent_code, company: company.Name }, new Date(row.created_at)) },
  ]
  const toolLog = []
  const ctx = {
    admin: db.client, profile, origin: 'https://stategen.app',
    legacy: async (instruction) => `[replay: the existing router would handle "${instruction}" — not run here]`,
  }
  const started = Date.now()
  let result
  try {
    result = await runAgentTurn({
      call: createCaller(system, TOOLS, undefined, MODEL),
      execute: async (name, input, state) => {
        const out = await executeTool(ctx, name, input, state)
        toolLog.push({ name, input, staged: Boolean(out.confirmation), error: Boolean(out.isError) })
        return out
      },
      messages: [...history, { role: 'user', content: row.message }],
    })
  } catch (err) {
    result = { reply: `[replay error: ${err.message}]`, ended: 'error', rounds: 0 }
  }
  const old = replyAfter(row)
  results.push({ at: row.created_at, agent: profile.Full_name, message: row.message, oldIntent: row.intent, oldReply: old?.message ?? '', newReply: result.reply, tools: toolLog, ended: result.ended, ms: Date.now() - started })
  console.log(`  ${i + 1}/${todo.length}  ${row.intent ?? '?'}  →  ${toolLog.map(t => t.name).join(', ') || 'reply only'}  (${result.ended}, ${Date.now() - started} ms)`)
}

// ── Report ──────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const rows = results.map(r => `
<section>
  <header>${esc(new Date(r.at).toLocaleString('en-GB', { timeZone: 'Asia/Beirut' }))} · ${esc(r.agent)}</header>
  <pre class="msg">${esc(r.message)}</pre>
  <div class="cols">
    <div><h3>Old bot <small>${esc(r.oldIntent)}</small></h3><pre>${esc(r.oldReply)}</pre></div>
    <div><h3>New agent <small>${esc(r.ended)} · ${r.ms} ms</small></h3><pre>${esc(r.newReply)}</pre>
      ${r.tools.map(t => `<details><summary>${esc(t.name)}${t.staged ? ' — staged' : ''}${t.error ? ' — error' : ''}</summary><pre>${esc(JSON.stringify(t.input, null, 2))}</pre></details>`).join('')}
    </div>
  </div>
</section>`).join('')

fs.writeFileSync(OUT, `<!doctype html><meta charset="utf-8"><title>Agent replay — ${esc(company.Name)}</title>
<style>
  body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#f6f7f9;color:#14223f}
  section{background:#fff;border:1px solid #e3e6ec;border-radius:10px;padding:14px;margin:0 0 14px}
  header{font-size:12px;color:#6a7488;margin-bottom:6px}
  pre{white-space:pre-wrap;word-break:break-word;margin:0;font:13px/1.45 ui-monospace,monospace}
  .msg{background:#eef6ee;padding:10px;border-radius:8px;margin-bottom:10px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media (max-width:700px){.cols{grid-template-columns:1fr}}
  h3{font-size:13px;margin:0 0 6px} small{color:#6a7488;font-weight:400}
  details{margin-top:6px;font-size:12px} summary{cursor:pointer;color:#2e5288}
</style>
<h1>Agent replay — ${esc(company.Name)} · ${esc(MODEL)}</h1>
<p>${results.length} real messages, replayed against a read-only snapshot. Nothing was saved anywhere. Contains client details — do not share.</p>
${rows}`)
console.log(`\nReport written: ${OUT}`)
