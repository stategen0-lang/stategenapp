// The one place the WhatsApp agent talks to Claude.
//
// Settings, and why:
//   • claude-opus-5-5 — at ~7 messages a day the cost is small, and reading a
//     messy forwarded brief correctly is the whole job.
//   • effort "medium" — Opus 5.5's thinking can't be switched off; effort is the
//     dial. Medium is its default; set explicitly so the behaviour doesn't move
//     if the default does. Override with WHATSAPP_AGENT_EFFORT.
//   • fallbacks: "default" — if a safety classifier wrongly declines a message,
//     the API re-runs it on Anthropic's recommended fallback model instead of
//     the agent getting a refusal. A false positive must not become an outage.
//   • block_binding drop_block — new accounts reject a request outright if a
//     replayed reasoning block's history changed. The loop is append-only and
//     history is rebuilt as plain text, so it shouldn't happen; if a future
//     change breaks that, the agent still gets an answer.
//   • No temperature: since 21 Oct 2026 the API rejects sampling parameters.
//   • Not streaming: replies are short and go out as one WhatsApp message, and
//     16k max_tokens keeps a non-streaming request well inside the timeout.
//   • tool_choice stays "auto": forcing a tool is a 400 on this model.

import Anthropic from '@anthropic-ai/sdk'

type Msg = Anthropic.Beta.BetaMessageParam
type Tool = Anthropic.Beta.BetaTool
type SystemBlock = Anthropic.Beta.BetaTextBlockParam

export const AGENT_MODEL = 'claude-opus-5-5'
const MAX_TOKENS = 16_000
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

export function agentEffort(raw = process.env.WHATSAPP_AGENT_EFFORT): Effort {
  const v = String(raw ?? '').trim().toLowerCase()
  return (EFFORTS as readonly string[]).includes(v) ? v as Effort : 'medium'
}

/** True when there is a credential to call the API with. */
export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

let shared: Anthropic | null = null
function anthropic(): Anthropic {
  // One retry, a per-request timeout well inside the webhook's maxDuration: an
  // agent waiting minutes for a reply has already given up on it.
  return (shared ??= new Anthropic({ timeout: 45_000, maxRetries: 1 }))
}

/**
 * A model call bound to this turn's system prompt and tools — the loop only
 * ever varies the messages. The system and tools must not change between the
 * rounds of one turn: they are the prefix the cache and the reasoning blocks
 * both depend on.
 */
export function createCaller(system: SystemBlock[], tools: Tool[], client: Anthropic = anthropic()) {
  const effort = agentEffort()
  return (messages: Msg[]) => client.beta.messages.create({
    model: AGENT_MODEL,
    max_tokens: MAX_TOKENS,
    betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    output_config: { effort },
    tool_choice: { type: 'auto' },
    system,
    tools,
    messages,
    // Caches the growing conversation, so round two of a turn reads round one
    // from cache. The tools + system prefix carry their own breakpoint.
    cache_control: { type: 'ephemeral' },
  })
}
