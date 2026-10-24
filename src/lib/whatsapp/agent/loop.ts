// One WhatsApp turn: the model reads the conversation, calls tools as it needs
// to, and ends with a reply.
//
// This replaces a router that classified each message on its own into one of 26
// labels. The logs show what that cost: an agent pasted a client's details
// eleven times, was asked for a phone number that was in the message, and gave
// up. A model holding the conversation, with tools to act, reads a pasted brief
// the way a colleague would.
//
// What it is NOT allowed to do is decide that a change happened. Writes go
// through tools that only *stage* them (pending_actions); the agent's "yes" is
// caught by deterministic code before the model ever runs, and commits. The
// rules that make that safe live here, in code, not in the prompt:
//
//   • at most one change staged per turn — stage() keeps one live action, so a
//     second would silently replace the first the agent was about to confirm;
//   • when something is staged, the reply ends with the confirmation built from
//     the actual payload, so the model cannot misstate what will be saved or
//     claim it already was;
//   • a tool input cut off by the token limit is never executed.
//
// The model call is injected, so all of this is tested without the API.

import type Anthropic from '@anthropic-ai/sdk'

type Msg = Anthropic.Beta.BetaMessageParam
type ModelMessage = Anthropic.Beta.BetaMessage
type ToolUse = Anthropic.Beta.BetaToolUseBlock
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam

export interface ToolOutcome {
  /** What the model reads back. */
  content: string
  isError?: boolean
  /**
   * The confirmation for a change this tool staged, exactly as the agent will be
   * asked to approve it. Its presence is what marks the turn as having staged a
   * write — set only when a pending action was really created.
   */
  confirmation?: string
  /**
   * The change ended without anything new waiting (cancel_waiting_change), so
   * the turn may still prepare one — "no, cancel that, I meant 1,200,000" is
   * one message. Its confirmation is still shown unless a later one replaces it.
   */
  leavesTurnOpen?: boolean
}

export interface TurnState {
  /** Set once a write is staged; later write tools in the same turn refuse. */
  staged: boolean
}

export interface AgentTurn {
  /** One request to the model with the conversation so far. */
  call: (messages: Msg[]) => Promise<ModelMessage>
  /** Run one tool. Receives the turn state so write tools can enforce one-per-turn. */
  execute: (name: string, input: unknown, state: TurnState) => Promise<ToolOutcome>
  /** Earlier turns as plain text, ending with the agent's new message. */
  messages: Msg[]
  /** Model round-trips allowed before giving up. */
  maxRounds?: number
  /**
   * Wall-clock time (epoch ms) after which no new round starts. The turn runs
   * inside the webhook's after(), which the platform kills at maxDuration — an
   * agent left with no reply at all is worse than one told to try again.
   */
  deadline?: number
  /** Injectable clock, for tests. */
  now?: () => number
}

export interface AgentResult {
  reply: string
  /** The canonical confirmation, when a change is waiting on "yes". */
  confirmation: string | null
  rounds: number
  toolCalls: { name: string; ok: boolean }[]
  /** Why the turn ended — kept for the log, so a bad turn can be diagnosed. */
  ended: 'reply' | 'refusal' | 'truncated' | 'round_limit' | 'empty' | 'deadline' | 'error'
  /** For 'error': what the API said, e.g. "401 authentication_error: invalid x-api-key". */
  error: string | null
}

/**
 * A model-call failure as one short line. Read off the SDK's error shape
 * without importing it, so the loop stays testable. The API's error messages
 * name what was wrong ("invalid x-api-key", a schema path) and never echo the
 * key itself.
 */
export function describeError(err: unknown): string {
  const e = err as { status?: number; error?: { error?: { type?: string; message?: string } }; message?: string }
  const status = typeof e?.status === 'number' ? `${e.status} ` : ''
  const type = e?.error?.error?.type ? `${e.error.error.type}: ` : ''
  const message = e?.error?.error?.message ?? e?.message ?? String(err)
  return `${status}${type}${message}`.replace(/\s+/g, ' ').trim().slice(0, 200)
}

// Eight: an Arabic name searched in a few spellings plus a match took six,
// and the turn ended "I got stuck". The deadline still bounds the time.
export const DEFAULT_MAX_ROUNDS = 8

// Replies for the turns that cannot end normally. Plain, and honest about
// nothing having been saved — the worst outcome is an agent believing a change
// went through when it did not.
export const REFUSED_REPLY = "Sorry, I can't help with that one. Nothing was saved."
export const TRUNCATED_REPLY = 'That was more than I could take in at once — nothing was saved. Could you send it again in two parts?'
export const ROUND_LIMIT_REPLY = "I got stuck working that out, so I've stopped — nothing was saved. Could you say it another way?"
export const EMPTY_REPLY = "Sorry, I didn't catch that. Could you say it another way?"
export const SLOW_REPLY = "That's taking me too long, so I've stopped — nothing was saved. Please try again in a moment."
export const ERROR_REPLY = "Something went wrong on my side — nothing was saved. Please try again in a moment."

function textOf(message: ModelMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
}

/**
 * The reply the agent receives. When a change is staged it ends with the
 * canonical confirmation, whatever the model wrote — the model may add a short
 * note ("Sarba isn't in my area list, so I used Jounieh"), never the summary.
 */
export function composeReply(modelText: string, confirmation: string | null): string {
  const text = modelText.trim()
  if (!confirmation) return text
  // The model was told not to repeat the details; if it pasted the summary
  // anyway, don't show it twice.
  if (!text || text.includes(confirmation.trim())) return confirmation
  return `${text}\n\n${confirmation}`
}

export async function runAgentTurn(turn: AgentTurn): Promise<AgentResult> {
  const messages: Msg[] = [...turn.messages]
  const state: TurnState = { staged: false }
  const toolCalls: AgentResult['toolCalls'] = []
  let confirmation: string | null = null
  let error: string | null = null
  const maxRounds = turn.maxRounds ?? DEFAULT_MAX_ROUNDS

  const done = (reply: string, ended: AgentResult['ended'], rounds: number): AgentResult =>
    ({ reply, confirmation, rounds, toolCalls, ended, error })

  const now = turn.now ?? Date.now
  // Whatever stops the turn early, a change already staged is still waiting on
  // the agent's "yes", so they are shown it rather than a bare apology.
  const stopEarly = (fallback: string, ended: AgentResult['ended'], round: number) =>
    done(confirmation ? composeReply('', confirmation) : fallback, ended, round)

  for (let round = 1; round <= maxRounds; round++) {
    if (turn.deadline !== undefined && now() > turn.deadline) return stopEarly(SLOW_REPLY, 'deadline', round)

    let res: ModelMessage
    try {
      res = await turn.call(messages)
    } catch (err) {
      // Rate limits, overload, network: the SDK has already retried. Nothing
      // the model said in this round was acted on.
      error = describeError(err)
      console.error('[whatsapp-agent] model call failed:', error)
      return stopEarly(ERROR_REPLY, 'error', round)
    }

    // Checked before anything is read: a refusal can stop a tool call
    // mid-input. With server-side fallbacks on, reaching here means every
    // model in the chain declined.
    if (res.stop_reason === 'refusal') return stopEarly(REFUSED_REPLY, 'refusal', round)

    // Only server-side tools pause; resume by sending the turn back unchanged.
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content })
      continue
    }

    const uses = res.content.filter((b): b is ToolUse => b.type === 'tool_use')

    if (uses.length === 0) {
      const text = textOf(res)
      if (!text && !confirmation) return done(EMPTY_REPLY, 'empty', round)
      return done(composeReply(text, confirmation), 'reply', round)
    }

    // A tool input cut off at max_tokens usually still parses as a smaller,
    // valid-looking object. Running it would write the truncated version.
    if (res.stop_reason === 'max_tokens') return stopEarly(TRUNCATED_REPLY, 'truncated', round)

    // The assistant turn goes back exactly as it came, thinking blocks
    // included — the history is append-only within a turn, which is what keeps
    // those blocks valid on the next request.
    messages.push({ role: 'assistant', content: res.content })

    // Sequential, not concurrent: write tools read and change the turn state,
    // and the order the model asked for them in is the order they make sense.
    const results: ToolResult[] = []
    for (const use of uses) {
      let out: ToolOutcome
      try {
        out = await turn.execute(use.name, use.input, state)
      } catch (err) {
        console.error('[whatsapp-agent] tool threw', use.name, err)
        out = { content: `The ${use.name} tool failed unexpectedly. Nothing was changed.`, isError: true }
      }
      if (out.confirmation) {
        if (!out.leavesTurnOpen) state.staged = true
        confirmation = out.confirmation
      }
      toolCalls.push({ name: use.name, ok: !out.isError })
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: out.content,
        ...(out.isError ? { is_error: true } : {}),
      })
    }
    // Every result in one message: splitting them teaches the model to stop
    // making parallel calls.
    messages.push({ role: 'user', content: results })
  }

  return stopEarly(ROUND_LIMIT_REPLY, 'round_limit', maxRounds)
}
