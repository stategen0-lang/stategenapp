// Server-only lead-score recalculation (the spec's /recalculate-score,
// implemented as a server module used by the API routes instead of a separate
// Edge Function deployment).
//
// For each client: behavior (pipeline recency + recent stage changes),
// profile fit (budget clarity + status timeline + best live match), agent
// rating — combined 50/30/20 and written to client_requests.lead_score.

import { createClient } from '@/lib/supabase/server'
import { dbRowToClient, dbRowToProperty } from '@/lib/db-mappers'
import { matchProperties } from '@/lib/matching'
import { behaviorScore, profileFitScore, ratingScore, leadScore } from '@/lib/scoring'

const DAY_MS = 86_400_000

type Row = Record<string, unknown>

export interface RecalcResult {
  updated: number
  scores: { clientId: number; score: number }[]
}

// Recalculate every client's score (optionally just one client).
export async function recalculateScores(opts: { clientId?: number; companyId?: number } = {}): Promise<RecalcResult> {
  const companyId = opts.companyId ?? Number(process.env.DEMO_COMPANY_ID ?? 1)
  // Runs inside a request that already has a signed-in session, so the
  // authenticated client is enough — no service-role key needed.
  const admin = await createClient()

  // 1. Load everything in bulk (53 clients / 57 properties — cheap).
  let clientQuery = admin.from('client_requests').select('*').eq('company_id', companyId)
  if (opts.clientId) clientQuery = clientQuery.eq('id', opts.clientId)
  const [{ data: clientRows }, { data: propRows }, { data: dealRows }] = await Promise.all([
    clientQuery,
    admin.from('Properties').select('*').eq('company_id', companyId),
    admin.from('deals').select('id,client_id,stage_changed_at,created_at').eq('company_id', companyId),
  ])

  const clients = (clientRows ?? []) as Row[]
  const properties = ((propRows ?? []) as Row[]).map((r, i) => dbRowToProperty(r, i))
  const dealByClient = new Map<number, Row>()
  for (const d of (dealRows ?? []) as Row[]) dealByClient.set(Number(d.client_id), d)

  // Stage changes in the last 14 days, grouped per deal.
  const since = new Date(Date.now() - 14 * DAY_MS).toISOString()
  const { data: histRows } = await admin
    .from('stage_history').select('deal_id').gte('changed_at', since)
  const eventsByDeal = new Map<string, number>()
  for (const h of (histRows ?? []) as Row[]) {
    const k = String(h.deal_id)
    eventsByDeal.set(k, (eventsByDeal.get(k) ?? 0) + 1)
  }

  const now = Date.now()
  const scores: { clientId: number; score: number }[] = []

  for (const row of clients) {
    const clientId = Number(row.id)
    const client = dbRowToClient(row, 0)
    const deal = dealByClient.get(clientId)

    // Behavior: recency of the latest pipeline touch + recent stage events.
    const lastTouch = Math.max(
      new Date((deal?.stage_changed_at as string) ?? 0).getTime() || 0,
      new Date((row.created_at as string) ?? 0).getTime() || 0,
    )
    const days = lastTouch ? Math.max(0, Math.floor((now - lastTouch) / DAY_MS)) : 30
    const events = deal ? (eventsByDeal.get(String(deal.id)) ?? 0) : 0
    const behavior = behaviorScore(days, events)

    // Profile fit: budget clarity + status timeline + best live match strength.
    const best = matchProperties(client, properties)[0]?.score.total ?? 0
    const fit = profileFitScore(client.budget, (row.status as string) ?? '', best)

    // Agent rating (stored 1-5; defaults to 3).
    const rating = ratingScore(Number(row.agent_rating ?? 3))

    const score = leadScore(behavior, fit, rating)
    scores.push({ clientId, score })
  }

  // 2. Persist (only rows whose score actually changed), in parallel batches —
  // 53 sequential round-trips took ~13s; batching keeps a full pass ~1-2s.
  const stamp = new Date().toISOString()
  const prevById = new Map(clients.map(c => [Number(c.id), c]))
  const pending = scores.filter(({ clientId, score }) => {
    const prev = prevById.get(clientId)
    return !(Number(prev?.lead_score) === score && prev?.score_updated_at)
  })

  let updated = 0
  const BATCH = 12
  for (let i = 0; i < pending.length; i += BATCH) {
    const results = await Promise.all(
      pending.slice(i, i + BATCH).map(({ clientId, score }) =>
        admin.from('client_requests')
          .update({ lead_score: score, score_updated_at: stamp })
          .eq('id', clientId)),
    )
    updated += results.filter(r => !r.error).length
  }

  return { updated, scores }
}
