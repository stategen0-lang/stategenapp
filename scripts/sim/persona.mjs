// A simulated agent: Haiku playing a Lebanese real-estate agent who has one
// thing to get done and texts the bot until it is — in their own style, typos
// and all. It sees only the bot's replies, never the agency's data beyond what
// its goal tells it, exactly like a real agent.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-5-5'
let client
const anthropic = () => (client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 }))

export const STYLES = {
  english_clear: 'Clear, complete English sentences.',
  english_terse: 'Very short English, no punctuation, abbreviations (pls, bdr, k for thousand, appt). Like texting while driving.',
  arabizi: 'Lebanese Arabizi — Arabic in Latin letters with numbers for sounds (3, 7, 2), e.g. "baddi ghayyer el budget la rita, 3mlo 1000". Mix in English real-estate words naturally.',
  arabic: 'Lebanese Arabic in Arabic script, with English words for numbers or property terms if natural.',
  mixed_typos: 'A mix of English and Arabizi, frequent typos and missing spaces, lowercase.',
  chatty: 'Friendly and wordy English, greetings, extra context the bot does not need, several things in one message.',
  forwarded: 'Paste details like a forwarded note: lines like "name: … / phone: … / budget: …", or a client message you received, then a short instruction.',
}

const SYSTEM = (goal, style) => `You are a real-estate agent in Lebanon texting your agency's WhatsApp assistant (a bot that manages the agency's clients and listings).

YOUR GOAL:
${goal}

HOW YOU WRITE: ${STYLES[style]}

Rules:
- Reply with ONLY your next WhatsApp message — no quotes, no explanations.
- Use only the facts in your goal; don't invent extra details unless the assistant asks something your goal doesn't cover (then answer briefly and plausibly).
- If the assistant shows a summary of a change and asks you to confirm (reply YES), check it against your goal. If it is right, confirm in your style (e.g. "yes", "eh", "aywa", "ok", "yalla", "تمام"). If something is wrong, say what to fix.
- If the assistant asks a question, answer it.
- When your goal is done — the assistant said it saved the change, or it gave you a clear answer to what you asked — reply exactly: DONE. Don't ask follow-ups beyond your goal and don't keep double-checking.
- If the assistant clearly explains why it can't do something (e.g. the client belongs to another agent), accept it and reply DONE.
- If the assistant clearly can't do it after you've tried a few times, reply exactly: STUCK`

/** Next message from the simulated agent, given the conversation so far. */
export async function personaSays({ goal, style, turns }) {
  // The chat as a transcript in one message, with the speakers named. Mapping
  // the persona to the "assistant" role made it drift into answering as the
  // bot ("I can't send that message from here").
  const transcript = turns.length
    ? turns.map(t => `YOU: ${t.message}\nASSISTANT (the bot): ${t.reply || '(no reply)'}`).join('\n\n')
    : '(The chat is empty — you are opening it.)'
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 600,
    thinking: { type: 'disabled' },
    system: SYSTEM(goal, style),
    messages: [{ role: 'user', content: `${transcript}\n\nWrite YOUR next WhatsApp message to the bot (or DONE / STUCK).` }],
  })
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
  return text.replace(/^["“]|["”]$/g, '')
}
