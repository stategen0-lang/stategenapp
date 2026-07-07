// Server-only — xAI (Grok) client using the OpenAI-compatible API

const XAI_BASE    = 'https://api.x.ai/v1'
const CHAT_MODEL  = 'grok-3'
const EMBED_MODEL = 'text-embedding-3-large'

function apiKey() {
  const k = process.env.XAI_API_KEY
  if (!k) throw new Error('XAI_API_KEY is not set')
  return k
}

// ── Chat completion ───────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chat(messages: Message[], options?: {
  model?: string
  temperature?: number
  max_tokens?: number
}): Promise<string> {
  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       options?.model       ?? CHAT_MODEL,
      temperature: options?.temperature ?? 0.3,
      max_tokens:  options?.max_tokens  ?? 1024,
      messages,
    }),
  })
  if (!res.ok) throw new Error(`xAI chat error ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.choices[0].message.content as string
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${XAI_BASE}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  })
  if (!res.ok) throw new Error(`xAI embed error ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return json.data[0].embedding as number[]
}
