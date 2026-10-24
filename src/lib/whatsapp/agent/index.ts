// The conversational WhatsApp agent — the entry point the webhook calls.
//
// Switched on per agency with WHATSAPP_AGENT:
//   unset / ""   → off everywhere (the existing router answers)
//   "all"        → on for every agency
//   "1,7"        → on for those company ids only
//
// It also needs a Claude credential. Turned on without one, it stays off rather
// than leaving agents with no replies — the old router keeps answering.

import type { SupabaseClient } from '@supabase/supabase-js'
import type Anthropic from '@anthropic-ai/sdk'
import type { Profile } from '../write-handlers.ts'
import type { BotReply } from '../cloud.ts'
import { runAgentTurn } from './loop.ts'
import { TOOLS, executeTool, type ToolContext } from './tools.ts'
import { SYSTEM_PROMPT, contextBlock } from './prompt.ts'
import { loadHistory } from './history.ts'
import { createCaller, claudeConfigured } from './client.ts'

/** Whether WHATSAPP_AGENT names this agency. Pure, for testing. */
export function agentEnabledFor(companyId: number, setting: string | undefined = process.env.WHATSAPP_AGENT): boolean {
  const s = String(setting ?? '').trim().toLowerCase()
  if (!s || s === 'off' || s === 'false' || s === '0') return false
  if (s === 'all' || s === 'on' || s === 'true') return true
  return s.split(',').map(x => x.trim()).filter(Boolean).includes(String(companyId))
}

/** On for this agency, and able to reach Claude. */
export function agentReady(companyId: number): boolean {
  return agentEnabledFor(companyId) && claudeConfigured()
}

// Leaves room for the reply to be sent before the webhook's maxDuration (120s)
// ends the function. Rounds already running finish; no new one starts after.
const TURN_BUDGET_MS = 75_000

export interface AgentInput {
  admin: SupabaseClient
  profile: Profile
  /** The agent's message, already cleaned of WhatsApp's invisible characters. */
  body: string
  /** The number the message came from — the key the conversation is logged under. */
  phone: string
  /** This message's own log row, left out of the history it is appended to. */
  inboundLogId: string | null
  origin: string
  /** The existing router, for requests with no native tool yet. */
  legacy: (instruction: string) => Promise<BotReply>
  /** Injected in tests; the real client otherwise. */
  claude?: Anthropic
}

export async function answerWithAgent(input: AgentInput): Promise<string> {
  const { admin, profile } = input

  const { data: company } = await admin.from('Companies').select('Name').eq('id', profile.company_id).maybeSingle()
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // Cached together with the tools that render before it.
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: contextBlock({
        name: profile.Full_name || 'the agent',
        role: profile.role,
        agentCode: profile.agent_code,
        company: (company?.Name as string) || 'their agency',
      }),
    },
  ]

  const history = await loadHistory(admin, input.phone, input.inboundLogId)
  const ctx: ToolContext = { admin, profile, origin: input.origin, legacy: input.legacy }
  const started = Date.now()

  const result = await runAgentTurn({
    call: input.claude ? createCaller(system, TOOLS, input.claude) : createCaller(system, TOOLS),
    execute: (name, toolInput, state) => executeTool(ctx, name, toolInput, state),
    messages: [...history, { role: 'user', content: input.body }],
    deadline: started + TURN_BUDGET_MS,
  })

  // One line per turn, for diagnosing a bad conversation from the logs. No
  // message text: it carries clients' names and numbers.
  console.info('[whatsapp-agent]', JSON.stringify({
    company: profile.company_id,
    ended: result.ended,
    rounds: result.rounds,
    staged: Boolean(result.confirmation),
    tools: result.toolCalls,
    ms: Date.now() - started,
  }))

  return result.reply
}
