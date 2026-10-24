// Server-only — the one place the app's AI features (listing descriptions,
// spreadsheet column mapping, the old WhatsApp router's classifier and field
// extractor) talk to a model. Claude Haiku 5.5, like the WhatsApp agent: the
// agency's choice, and the cheapest model that does these jobs well.
//
// Replaced the xAI (Grok) client in October 2026. Grok-3, the model it ran, was
// retired; and Grok is a reasoning model whose hidden thinking could eat the
// whole token budget and return an empty string — the bug behind several
// "description came back blank" reports.
//
// Request shape, and why:
//   • thinking disabled — these are short, single-shot jobs (a paragraph, a
//     JSON object) where latency matters more than deliberation; Haiku 5.5
//     accepts it at its default effort. Every output token is the answer.
//   • no temperature/top_p — Haiku 5.5 rejects non-default sampling settings
//     with a 400. Variety comes from the prompt; JSON jobs say "ONLY JSON".
//   • the conversation must end with a user turn — Haiku 5.5 rejects prefill.

import Anthropic from '@anthropic-ai/sdk'

export const LLM_MODEL = 'claude-haiku-5-5'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

let shared: Anthropic | null = null
function client(): Anthropic {
  // One retry for a rate limit or overload; callers set their own deadlines.
  return (shared ??= new Anthropic({ timeout: 45_000, maxRetries: 1 }))
}

/**
 * One completion: the model's text, or '' when it declined. System messages
 * become the system prompt; the rest must alternate and end with the user.
 * Throws on API errors so each caller keeps its own fallback.
 */
export async function complete(messages: Message[], opts: { maxTokens?: number } = {}): Promise<string> {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const turns = messages.filter(m => m.role !== 'system') as { role: 'user' | 'assistant'; content: string }[]
  if (!turns.length || turns[turns.length - 1].role !== 'user') {
    throw new Error('complete(): the last message must be from the user')
  }
  const res = await client().messages.create({
    model: LLM_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    thinking: { type: 'disabled' },
    ...(system ? { system } : {}),
    messages: turns,
  })
  if (res.stop_reason === 'refusal') return ''
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
}
