// One conversation through the real router, against a private copy of the
// agency. Each message goes the way a WhatsApp message does in production:
// cleaned, logged inbound, routed (the yes/no check, then the agent), and the
// reply logged outbound — so the agent's history works exactly as it does live.

import { cleanInboundText } from '../../src/lib/whatsapp/clean-text.ts'
import { replyText } from '../../src/lib/whatsapp/cloud.ts'
import { continuePhotoCollection, NO_REPLY } from '../../src/lib/whatsapp/photo-handlers.ts'
import { freshDb } from './world.mjs'
import { scope } from './lockdown.mjs'
import { checkTurn } from './checks.mjs'

const LOG_TABLES = new Set(['whatsapp_logs'])

/**
 * @param o.route      the router's route() — imported after lockdown
 * @param o.snapshot   loadSnapshot() result
 * @param o.profile    the Profiles row the messages come from
 * @param o.next       async (turns) => next message, or null to stop
 * @param o.maxTurns   hard stop
 */
export async function converse({ route, snapshot, profile, next, maxTurns = 8, origin = 'https://stategenapp.vercel.app' }) {
  const db = freshDb(snapshot)
  const phone = profile.whatsapp_number || `9617${String(profile.id).replace(/\D/g, '').padEnd(7, '0').slice(0, 7)}`
  const turns = []
  // Messages a few seconds apart, in order, so history sorts as it does live.
  let clock = Date.now() - maxTurns * 60_000

  for (let i = 0; i < maxTurns; i++) {
    const message = await next(turns, db)
    if (message == null) break
    const body = cleanInboundText(message)

    const hadPending = db.table('pending_actions').length > 0
    const writesBefore = db.writes.length
    const capture = { calls: [], blocked: [] }
    const started = Date.now()

    const [inbound] = (await db.client.from('whatsapp_logs').insert({
      company_id: profile.company_id, profile_id: profile.id, from_number: phone,
      direction: 'inbound', message: body, created_at: new Date(clock += 20_000).toISOString(),
    }).select('id')).data ?? []

    let routed
    try {
      routed = await scope.run(capture, async () => {
        // What the webhook does before routing: just after a new listing, a
        // text message ends the "send photos" window ("done" included).
        const photo = await continuePhotoCollection(db.client, profile, { from: phone, text: body, name: '', messageId: `sim-${i}`, type: 'text' }, origin)
        if (photo !== null) return { intent: 'collect_photo', answer: photo === NO_REPLY ? '' : photo }
        return route(db.client, profile, body, origin, { phone, inboundLogId: inbound?.id ?? null })
      })
    } catch (err) {
      routed = { intent: 'crash', answer: `[router threw: ${err?.message ?? err}]` }
    }
    const reply = replyText(routed.answer)

    await db.client.from('whatsapp_logs').insert({
      company_id: profile.company_id, profile_id: profile.id, from_number: phone,
      direction: 'outbound', message: reply, intent: routed.intent, created_at: new Date(clock += 5_000).toISOString(),
    })

    const writes = db.writes.slice(writesBefore).filter(w => !LOG_TABLES.has(w.table))
    const turn = {
      message, reply, intent: routed.intent, writes, hadPending,
      staged: db.table('pending_actions').length > 0 && writes.some(w => w.table === 'pending_actions' && w.op === 'insert'),
      calls: capture.calls, effects: capture.blocked.map(b => `${b.where} → ${b.host}`),
      ms: Date.now() - started,
    }
    turn.problems = routed.intent === 'crash'
      ? [{ check: 'router_crash', detail: reply }]
      : checkTurn(turn, { db, profile, snapshot })
    turns.push(turn)
  }
  return { turns, db }
}

/** What the agent's tools returned during a turn — the evidence for the judge. */
export function toolEvidence(turn) {
  const last = turn.calls.at(-1)?.request?.messages ?? []
  const out = []
  for (const m of last) {
    if (!Array.isArray(m.content)) continue
    for (const b of m.content) {
      if (b.type === 'tool_use') out.push(`CALL ${b.name} ${JSON.stringify(b.input)}`)
      if (b.type === 'tool_result') out.push(`RESULT ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}`)
    }
  }
  return out.join('\n').slice(-12_000)
}
