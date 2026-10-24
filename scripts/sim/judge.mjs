// A second opinion on each reply: is everything it states backed by what the
// bot's tools actually returned, and did it do what the agent asked? The
// literal checks catch wrong numbers; this catches the rest — a listing called
// a match when it isn't, a question already answered, a request ignored.
//
// Haiku, like the bot (the user's standing choice). Its verdicts are leads to
// read, not a score to trust: every flagged turn is looked at by hand.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-5-5'
let client
const anthropic = () => (client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 }))

const SYSTEM = `You grade replies from a WhatsApp assistant used by real-estate agents in Lebanon. Agents write in English, Arabizi (Lebanese Arabic in Latin letters, with numbers for sounds: 3=ع, 7=ح, 2=ء), Arabic, or a mix, often with typos.

The assistant can look up and change the agency's clients and listings through tools. Changes are never saved directly: the assistant prepares them and the agent replies "yes" to save. A reply that ends with "About to …  Reply YES to save" is a prepared change, not a save.

You see: the agent's message, the evidence (the tool calls the assistant made this turn and what they returned — the ONLY source of facts about the agency's data), and the reply.

Fail the reply only for a real problem an agent would care about:
- unsupported_fact: it states something about a client or listing (price, bedrooms, area, rent vs sale, status, budget, who owns it, that it exists) that the evidence does not support. General knowledge and the agent's own words are fine.
- wrong_match: it presents a listing or client as fitting the request when the evidence shows it doesn't (e.g. calls a 4-bedroom a 2-bedroom, a sale a rental).
- ignored_request: it didn't do or address what was asked, when it could have.
- needless_question: it asks for something already given in the message or conversation.
- wrong_action: it prepared a change different from what was asked (wrong client, wrong field, wrong value).
- false_save: it says something was saved/changed when this turn only prepared it, or nothing happened.
- confusing: the agent would not know what happened or what to do next.
- wrong_language: it answered in a different language than the agent wrote in (Arabizi may be answered in English or Arabizi).

Do not fail for style, brevity, or for asking a genuinely needed clarifying question. When there's no evidence (no tool calls), only fail for things the reply could not know.`

const VERDICT_TOOL = {
  name: 'verdict',
  description: 'Record the grade for this reply.',
  input_schema: {
    type: 'object',
    properties: {
      pass: { type: 'boolean' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['unsupported_fact', 'wrong_match', 'ignored_request', 'needless_question', 'wrong_action', 'false_save', 'confusing', 'wrong_language'] },
            detail: { type: 'string', description: 'One sentence: what is wrong, quoting the reply.' },
          },
          required: ['kind', 'detail'],
        },
      },
    },
    required: ['pass', 'issues'],
  },
}

/**
 * @param o.history  earlier turns as [{ message, reply }]
 * @param o.turn     { message, reply }
 * @param o.evidence toolEvidence(turn)
 */
export async function judge({ history, turn, evidence, agentName }) {
  const convo = history.slice(-4).map(t => `AGENT: ${t.message}\nASSISTANT: ${t.reply}`).join('\n\n')
  // Facts the reply may rely on that aren't tool results: who the agent is,
  // and what this turn actually saved — a bare "yes" is saved by code with no
  // tool call, which otherwise reads as a false claim.
  const commits = turn.writes.filter(w => /client_requests|Properties|deals|offers|calendar_events|stage_history/.test(w))
  const facts = [
    `The agent is ${agentName}. Today is ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Beirut', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} in Beirut (the assistant is told this too).`,
    turn.intent === 'confirm_pending' ? 'This message was a plain yes/no, handled by code rather than the assistant: it saved or cancelled the waiting change, and the reply is the system\'s own confirmation.' : null,
    commits.length ? `This turn really wrote to the database: ${commits.join(', ')}.` : 'This turn wrote nothing to the agency\'s records.',
    'By design the assistant never messages clients itself; drafting a message for the agent to forward is correct.',
  ].filter(Boolean).join(' ')
  const content = [
    `FACTS: ${facts}`,
    convo ? `Earlier in the conversation:\n${convo}` : 'This is the first message.',
    `AGENT'S MESSAGE:\n${turn.message}`,
    `EVIDENCE (tool calls this turn):\n${evidence || '(none — the assistant used no tools)'}`,
    `REPLY TO GRADE:\n${turn.reply}`,
  ].join('\n\n---\n\n')
  try {
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 2000,
      thinking: { type: 'disabled' },
      system: SYSTEM,
      tools: [VERDICT_TOOL],
      tool_choice: { type: 'tool', name: 'verdict' },
      messages: [{ role: 'user', content }],
    })
    const use = res.content.find(b => b.type === 'tool_use')
    if (!use) return { pass: true, issues: [], error: `no verdict (${res.stop_reason})` }
    return { pass: Boolean(use.input.pass), issues: Array.isArray(use.input.issues) ? use.input.issues : [] }
  } catch (err) {
    return { pass: true, issues: [], error: String(err?.message ?? err).slice(0, 200) }
  }
}
