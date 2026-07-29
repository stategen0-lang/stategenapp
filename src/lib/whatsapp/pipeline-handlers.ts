// Deal-pipeline over WhatsApp: read the board ("what's in negotiation", "show
// my pipeline") and move a deal along it ("move Ahmed to negotiating", "mark
// Ahmed as won"). Moves go through the same confirm-before-write step as every
// other write; reads honour the same permission rules as the web board (an agent
// sees only their own deals, a manager sees the whole company).

import type { SupabaseClient } from '@supabase/supabase-js'
import { isManager, canSeeClientPII, maskClientName } from '@/lib/permissions'
import { STAGES, isStage, type Stage, type Outcome } from '@/lib/pipeline'
import { formatPrice } from '@/lib/data'
import { stageLabel, targetLabel, type DealTarget } from '@/lib/whatsapp/deals'
import { confirmationText } from '@/lib/whatsapp/writes'
import { stage, resolveClient, type Profile } from '@/lib/whatsapp/write-handlers'
import type { IntentResult } from '@/lib/whatsapp/intent'

type Row = Record<string, unknown>

function toSession(p: Profile) {
  return {
    userId: p.id,
    companyId: p.company_id,
    role: p.role as 'owner' | 'manager' | 'agent',
    agentCode: p.agent_code,
    fullName: p.Full_name ?? 'Agent',
  }
}

/** Rebuild a concrete pipeline target from the classified fields. */
function targetFromFields(fields?: Record<string, string | number | boolean>): DealTarget | null {
  const s = fields?.stage
  if (!isStage(s)) return null
  if (s === 'closed') {
    const o = fields?.outcome
    return o === 'won' || o === 'lost' ? { stage: s, outcome: o as Outcome } : { stage: s, outcome: undefined }
  }
  return { stage: s, outcome: null }
}

// ── "move Ahmed to negotiating" / "mark Ahmed as won" ────────────────────────
export async function stageDealMove(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const target = targetFromFields(intent.fields)
  if (!target) return 'Which stage? Try "move Ahmed to negotiating" or "mark Ahmed as won".'

  const found = await resolveClient(admin, profile, intent.clientName)
  if (!found.ok) return found.message
  const client = found.row
  const name = client['Client Name'] as string

  const { data: deals } = await admin
    .from('deals')
    .select('id, agent_id, stage, value')
    .eq('company_id', profile.company_id)
    .eq('client_id', Number(client.id))
    .order('created_at', { ascending: false })

  const deal = (deals ?? [])[0] as Row | undefined
  if (!deal) return `${name} has no deal in the pipeline yet — deals are started from the pipeline board.`

  if (!isManager(profile.role) && deal.agent_id !== profile.agent_code) {
    return `${name}'s deal belongs to another agent, so I can't move it.`
  }

  // "closed" with no won/lost is ambiguous — ask rather than guess.
  if (target.stage === 'closed' && target.outcome === undefined) {
    return `Is ${name}'s deal won or lost? Reply "mark ${name} as won" or "mark ${name} as lost".`
  }

  const from = deal.stage as Stage
  if (from === target.stage && target.stage !== 'closed') {
    return `${name}'s deal is already at ${stageLabel(from)}.`
  }

  const changes = [`Stage: ${stageLabel(from)} → ${targetLabel(target)}`]
  const summary = confirmationText(`${name}'s deal`, changes)
  return stage(admin, profile, 'update_deal', summary, {
    table: 'deals',
    id: deal.id as string,
    columns: { stage: target.stage, ...(target.outcome ? { outcome: target.outcome } : {}) },
    extras: {},
    label: `${name}'s deal`,
  })
}

// ── "what's in negotiation" / "show my pipeline" ─────────────────────────────
export async function handleQueryPipeline(
  admin: SupabaseClient,
  profile: Profile,
  intent: IntentResult,
): Promise<string> {
  const manager = isManager(profile.role)
  const session = toSession(profile)

  let q = admin
    .from('deals')
    .select('id, agent_id, client_id, stage, outcome, value, client_requests(id,"Client Name",lead_score)')
    .eq('company_id', profile.company_id)
  if (!manager) q = q.eq('agent_id', profile.agent_code)   // agents: own deals only

  const { data } = await q
  const deals = (data ?? []) as Row[]
  if (!deals.length) return manager ? 'No deals in the pipeline yet.' : 'You have no deals in the pipeline yet.'

  const nameOf = (d: Row): string => {
    const c = d.client_requests as Row | null
    return canSeeClientPII(session, d.agent_id as string)
      ? ((c?.['Client Name'] as string) || 'Unknown client')
      : maskClientName(Number(c?.id ?? d.client_id))
  }
  const scoreOf = (d: Row): number => Number((d.client_requests as Row | null)?.lead_score ?? 0)
  const valueOf = (d: Row): number => Number(d.value) || 0
  const whose = manager ? 'the team' : 'you'

  // A named stage: list those deals, hottest first.
  const stageFilter = intent.fields?.stage
  if (isStage(stageFilter)) {
    const inStage = deals
      .filter(d => d.stage === stageFilter)
      .sort((a, b) => scoreOf(b) - scoreOf(a) || valueOf(b) - valueOf(a))
    if (!inStage.length) return `Nothing in ${stageLabel(stageFilter)} for ${whose} right now.`

    const total = inStage.reduce((s, d) => s + valueOf(d), 0)
    const lines = inStage.slice(0, 8).map(d => {
      const o = d.outcome ? ` (${d.outcome})` : ''
      return `• ${nameOf(d)} — ${formatPrice(valueOf(d))}${o} · score ${scoreOf(d)}`
    })
    const more = inStage.length > 8 ? `\n…and ${inStage.length - 8} more.` : ''
    return `${inStage.length} in ${stageLabel(stageFilter)} · ${formatPrice(total)} total:\n${lines.join('\n')}${more}`
  }

  // No stage named: a per-stage summary of the whole pipeline.
  const header = manager ? "The team's pipeline:" : 'Your pipeline:'
  const rows = STAGES.map(s => {
    const ds = deals.filter(d => d.stage === s.id)
    if (!ds.length) return null
    const total = ds.reduce((sum, d) => sum + valueOf(d), 0)
    return `• ${s.label}: ${ds.length} deal${ds.length > 1 ? 's' : ''} · ${formatPrice(total)}`
  }).filter(Boolean) as string[]

  const grand = deals.reduce((s, d) => s + valueOf(d), 0)
  return [
    header,
    ...rows,
    '',
    `${deals.length} deals · ${formatPrice(grand)} total. Ask "what's in negotiation" to see a stage.`,
  ].join('\n')
}
