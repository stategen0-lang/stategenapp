// Conversation simulator for the WhatsApp agent.
//
//   node --env-file=.env.local --experimental-strip-types --import ./scripts/test-setup.mjs \
//        scripts/agent-sim.mjs --company 1 --as a2 --count 40 --budget 1 --yes
//
// Simulated agents (Haiku) each get a goal built from the agency's real data —
// add a client, change a budget, find rentals, cancel a change — and text the
// bot until it's done. The bot is the production code (lib/whatsapp/router.ts:
// the yes/no check, then the agent), running against an in-memory copy of the
// agency. Afterwards:
//   • goals that change data are checked against that copy: exactly the right
//     record, exactly the right value, and only after a "yes";
//   • every reply goes through literal checks (invented listings, wrong prices,
//     rent/sale mix-ups, "saved" with nothing saved, gave up, privacy) and a
//     Haiku judge that sees what the bot's tools returned.
//
// SAFE BY CONSTRUCTION: production is read once, then every credential except
// the model APIs' is removed and the network is closed to everything else (see
// scripts/sim/lockdown.mjs). Nothing is written anywhere, no WhatsApp message
// or email can be sent. It costs Anthropic credit, so it does nothing without
// --yes, and stops starting conversations at --budget dollars.
//
// The report contains the agency's client names and numbers: it is written
// outside the repo and must not be committed.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadSnapshot } from './sim/world.mjs'
import { lockdown, costSoFar, usage, blocked } from './sim/lockdown.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1] }
const COMPANY = Number(arg('company', '1'))
const AS = arg('as', 'a2')
const COUNT = Number(arg('count', '20'))
const CONCURRENCY = Number(arg('concurrency', '6'))
const BUDGET = Number(arg('budget', '1'))
const SEED = Number(arg('seed', String(Date.now() % 100000)))
const ONLY = arg('only', '')           // comma-separated goal kinds
const MAX_TURNS = Number(arg('turns', '8'))
const JUDGE = !process.argv.includes('--no-judge')
const CONFIRMED = process.argv.includes('--yes')
const OUT = arg('out', path.join(os.tmpdir(), 'stategen-sim', new Date().toISOString().replace(/[:.]/g, '-')))

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) { console.error('No ANTHROPIC_API_KEY in the environment.'); process.exit(1) }

// ── Read production once, then seal ──────────────────────────────────────────
const snapshot = await loadSnapshot(COMPANY)
const profile = snapshot.Profiles.find(p => p.agent_code === AS || p.id === AS)
if (!profile) { console.error(`No profile "${AS}" in company ${COMPANY}. Codes: ${snapshot.Profiles.map(p => p.agent_code).join(', ')}`); process.exit(1) }
lockdown({ companyId: COMPANY })

// Imported only now, so nothing in them can have built a client from the
// credentials lockdown removed.
const { route } = await import('../src/lib/whatsapp/router.ts')
const { converse, toolEvidence } = await import('./sim/converse.mjs')
const { makeGoals, rng } = await import('./sim/goals.mjs')
const { personaSays, STYLES } = await import('./sim/persona.mjs')
const { judge } = await import('./sim/judge.mjs')

let goals = makeGoals(snapshot, profile, ONLY ? COUNT * 20 : COUNT, SEED)
if (ONLY) goals = goals.filter(g => ONLY.split(',').includes(g.kind)).slice(0, COUNT)
const styles = Object.keys(STYLES)
const r = rng(SEED + 7)

console.log(`${snapshot.Companies[0].Name} as ${profile.Full_name} (${profile.role}) — ${goals.length} conversations, ${CONCURRENCY} at a time, budget $${BUDGET}, seed ${SEED}`)
console.log(`Goal kinds: ${[...new Set(goals.map(g => g.kind))].join(', ')}`)
if (!CONFIRMED) { console.log('\nNothing run. Add --yes (this calls the Claude API and costs money).'); process.exit(0) }
fs.mkdirSync(OUT, { recursive: true })
const out = fs.createWriteStream(path.join(OUT, 'results.jsonl'))

// ── Run ──────────────────────────────────────────────────────────────────────
const results = []
let next = 0, stoppedForBudget = false

async function runOne(goal) {
  const style = styles[Math.floor(r() * styles.length)]
  let ending = null
  const started = Date.now()
  let convo
  try {
    convo = await converse({
      route, snapshot, profile, maxTurns: MAX_TURNS,
      next: async (turns) => {
        const said = await personaSays({ goal: goal.goal, style, turns, who: { name: profile.Full_name, role: profile.role === 'agent' ? 'an agent' : 'a manager' } })
        if (/^DONE\b/.test(said)) { ending = 'done'; return null }
        if (/^STUCK\b/.test(said)) { ending = 'stuck'; return null }
        return said
      },
    })
  } catch (err) {
    return { goal, style, error: String(err?.stack ?? err).slice(0, 500), turns: [], problems: [{ check: 'harness_error', detail: String(err?.message ?? err) }] }
  }
  const { turns, db } = convo
  const problems = []
  for (const [i, t] of turns.entries()) for (const p of t.problems) problems.push({ ...p, turn: i + 1 })
  if (ending === 'stuck') problems.push({ check: 'agent_stuck', detail: 'the simulated agent gave up' })
  if (ending === null) problems.push({ check: 'not_finished', detail: `no resolution in ${MAX_TURNS} messages` })
  if (goal.writes && goal.verify) {
    const wrong = goal.verify(db)
    if (wrong) problems.push({ check: 'goal_not_met', detail: wrong })
  }
  if (JUDGE) {
    const verdicts = await Promise.all(turns.map((t, i) => judge({ history: turns.slice(0, i), turn: { ...t, writes: t.writes.map(w => `${w.op} ${w.table}`) }, evidence: toolEvidence(t), agentName: profile.Full_name })))
    for (const [i, v] of verdicts.entries()) {
      turns[i].judge = v
      if (!v.pass) for (const issue of v.issues) problems.push({ check: `judge:${issue.kind}`, detail: issue.detail, turn: i + 1 })
    }
  }
  return {
    goal: { id: goal.id, kind: goal.kind, text: goal.goal }, style, ending, ms: Date.now() - started,
    turns: turns.map(t => ({ message: t.message, reply: t.reply, intent: t.intent, staged: t.staged, writes: t.writes.map(w => `${w.op} ${w.table}`), effects: t.effects, problems: t.problems, judge: t.judge, ms: t.ms, tools: t.calls.flatMap(c => (c.response?.content ?? []).filter(b => b.type === 'tool_use').map(b => b.name)) })),
    problems,
  }
}

async function worker() {
  while (next < goals.length) {
    if (costSoFar() >= BUDGET * 0.95) { stoppedForBudget = true; return }
    const goal = goals[next++]
    const res = await runOne(goal)
    results.push(res)
    out.write(JSON.stringify(res) + '\n')
    const mark = res.problems.length ? `✗ ${[...new Set(res.problems.map(p => p.check))].join(', ')}` : '✓'
    console.log(`[${results.length}/${goals.length}] $${costSoFar().toFixed(3)}  ${res.goal.id} (${res.style}, ${res.turns.length} msgs)  ${mark}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
out.end()

// ── Summary ──────────────────────────────────────────────────────────────────
const byCheck = {}
for (const res of results) for (const p of res.problems) (byCheck[p.check] ??= []).push(`${res.goal.id}${p.turn ? ` t${p.turn}` : ''}: ${p.detail}`)
const byKind = {}
for (const res of results) { const k = (byKind[res.goal.kind] ??= { n: 0, clean: 0 }); k.n++; if (!res.problems.length) k.clean++ }
const turnCount = results.reduce((n, res) => n + res.turns.length, 0)

const lines = [
  `# Simulation — ${snapshot.Companies[0].Name} as ${profile.Full_name}`,
  `${results.length} conversations, ${turnCount} bot turns, seed ${SEED}${stoppedForBudget ? ' — STOPPED AT BUDGET' : ''}`,
  `Cost: $${costSoFar().toFixed(3)}  ${JSON.stringify(usage)}`,
  `Clean conversations: ${results.filter(x => !x.problems.length).length}/${results.length}`,
  blocked.length ? `Network calls blocked (would have happened in production): ${[...new Set(blocked.map(b => `${b.where}→${b.host}`))].join(', ')}` : 'No network calls blocked.',
  '', '## By goal kind', ...Object.entries(byKind).map(([k, v]) => `- ${k}: ${v.clean}/${v.n} clean`),
  '', '## Problems by check',
  ...Object.entries(byCheck).sort((a, b) => b[1].length - a[1].length).flatMap(([k, v]) => [`### ${k} (${v.length})`, ...v.slice(0, 12).map(x => `- ${x.replace(/\s+/g, ' ').slice(0, 300)}`)]),
]
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n'))
console.log('\n' + lines.join('\n'))
console.log(`\nFull results: ${path.join(OUT, 'results.jsonl')}`)
