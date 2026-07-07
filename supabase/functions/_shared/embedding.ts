// Shared utility — runs in Deno (Supabase Edge Functions)
// Uses xAI (Grok) embeddings — OpenAI-compatible API

const EMBED_MODEL = 'text-embedding-3-large'

export function buildPropertyText(p: {
  type: string; location: string; price: number;
  bedrooms: number; area: number; amenities: string[]
}): string {
  return `${p.type} in ${p.location}, price $${p.price}, ${p.bedrooms} bedrooms, ${p.area}sqm, amenities: ${p.amenities.join(', ')}`
}

export function buildClientText(c: {
  preferred_type: string; preferred_location: string;
  budget_max: number; bedrooms: number; amenity_wishlist: string[]
}): string {
  return `Looking for ${c.preferred_type} in ${c.preferred_location}, budget $${c.budget_max}, needs ${c.bedrooms} bedrooms, wants: ${c.amenity_wishlist.join(', ')}`
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const key = Deno.env.get('XAI_API_KEY')
  if (!key) throw new Error('XAI_API_KEY not set')

  const res = await fetch('https://api.x.ai/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  })
  if (!res.ok) throw new Error(`xAI embedding error: ${res.status} ${await res.text()}`)
  const { data } = await res.json()
  return data[0].embedding
}
