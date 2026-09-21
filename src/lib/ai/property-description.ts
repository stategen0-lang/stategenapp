// Shared AI listing-description generation.
//
// Used by both the /api/ai/property-description route and the WhatsApp bot's
// "write a description for #23" flow, so both generate through exactly the same
// prompts and reasoning-token handling — one source of truth, no internal HTTP
// hop. The pure prompt-building lives in ./description-prompts (unit-tested);
// this file only adds the Grok call, empty-completion retry, and deadline.

import { chat } from '@/lib/xai'
import { buildPrompts, buildArabicPrompts, hasArabic, stripTemplateMarkers, type DescriptionInput } from '@/lib/ai/description-prompts'

export type { DescriptionInput }
export { buildFacts, buildPrompts } from '@/lib/ai/description-prompts'

const tidy = (s: string) =>
  // Code fences first, then the template markers the model sometimes echoes.
  stripTemplateMarkers(s.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, ''))

function withDeadline<T>(promise: Promise<T>, ms?: number): Promise<T> {
  if (!ms) return promise
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('description timed out')), Math.max(ms, 1))),
  ])
}

/**
 * Generate a description. Returns the finished text, or '' if the model spent
 * its whole budget reasoning and produced nothing.
 *
 *   retry     — try a second time on an empty completion (web: yes; WhatsApp: no,
 *               there's no time inside Twilio's 15s webhook window).
 *   deadlineMs— reject the call if it runs long (WhatsApp only). Left unset on
 *               the web, where the request can take as long as it needs.
 */
export async function generateDescription(
  d: DescriptionInput,
  template?: string | null,
  opts: { retry?: boolean; deadlineMs?: number } = {},
): Promise<string> {
  const { systemPrompt, prompt, maxTokens, temperature } = buildPrompts(d, template)
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: prompt },
  ]
  const call = () => chat(messages, { temperature, max_tokens: maxTokens })

  let clean = tidy(await withDeadline(call(), opts.deadlineMs))
  if (!clean && (opts.retry ?? true)) clean = tidy(await withDeadline(call(), opts.deadlineMs))
  return clean
}

/**
 * The Arabic version of a description that already exists.
 *
 * Returns '' when the model produced nothing, or answered in English anyway —
 * better to tell the agent it failed than to save a second English copy under
 * an Arabic heading.
 */
export async function generateArabicDescription(
  english: string,
  d: DescriptionInput,
  opts: { retry?: boolean; deadlineMs?: number } = {},
): Promise<string> {
  const source = String(english ?? '').trim()
  if (!source) return ''

  const { systemPrompt, prompt, maxTokens, temperature } = buildArabicPrompts(d, source)
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: prompt },
  ]
  const call = () => chat(messages, { temperature, max_tokens: maxTokens })

  let clean = tidy(await withDeadline(call(), opts.deadlineMs))
  if (!clean && (opts.retry ?? true)) clean = tidy(await withDeadline(call(), opts.deadlineMs))
  return hasArabic(clean) ? clean : ''
}
