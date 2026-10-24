// The conversation so far, from whatsapp_logs.
//
// Memory is the whole point. "Add furnished" means nothing on its own; after a
// client brief it means "add furnished to that client". The old router read
// every message alone, which is why an agent who typed exactly that was asked
// "Which listing? Include its number".
//
// Earlier turns go back to the model as PLAIN TEXT, never with the reasoning
// blocks they were produced with. That is what keeps this safe under
// "preserved thinking": a replayed reasoning block is only valid if everything
// before it is byte-identical, and rebuilding the history each turn from the
// log cannot promise that. Replaying none is the documented safe form.

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

type Msg = Anthropic.Beta.BetaMessageParam

export interface LogRow {
  id: string | number
  direction: string
  message: string | null
  created_at: string
}

/** How far back a conversation reaches. Past this, a message starts fresh. */
export const CONVERSATION_WINDOW_HOURS = 6
/** Most messages carried, so a long session can't grow without bound. */
export const MAX_HISTORY_MESSAGES = 20
/** A forwarded brief is a few hundred characters; this only stops runaways. */
export const MAX_MESSAGE_CHARS = 2000

/**
 * Log rows, oldest first, as model messages: inbound is the agent, outbound is
 * us. Starts on the agent's side (the API requires it) and merges runs from one
 * side — two outbound rows in a row happen whenever a reminder lands.
 */
export function toMessages(rows: LogRow[]): Msg[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const row of rows) {
    const text = String(row.message ?? '').trim()
    if (!text) continue
    const role = row.direction === 'inbound' ? 'user' : 'assistant'
    if (!out.length && role === 'assistant') continue
    const clipped = text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text
    const last = out[out.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n\n${clipped}`
    else out.push({ role, content: clipped })
  }
  return out
}

/**
 * The recent conversation with this number, excluding the message being
 * answered — the webhook logs it before this runs, and the caller appends it
 * itself as the final turn.
 */
export async function loadHistory(
  admin: SupabaseClient,
  phone: string,
  excludeId: string | null,
  now: Date = new Date(),
): Promise<Msg[]> {
  const since = new Date(now.getTime() - CONVERSATION_WINDOW_HOURS * 3_600_000).toISOString()
  const { data } = await admin
    .from('whatsapp_logs')
    .select('id, direction, message, created_at')
    .eq('from_number', phone)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_MESSAGES + 1)

  const rows = ((data ?? []) as LogRow[])
    .filter(r => excludeId == null || String(r.id) !== String(excludeId))
    .slice(0, MAX_HISTORY_MESSAGES)
    .reverse()
  return toMessages(rows)
}
