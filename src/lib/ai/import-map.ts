import { chat } from '@/lib/xai'
import { FIELDS, type ImportKind, type Mapping } from '@/lib/import/mapping'

// Ask Grok to map the sheet's columns to our fields — ONCE, from the headers and
// a few sample rows. The mapping is then applied to every row in code, so cost
// doesn't grow with the number of rows.
export async function inferMapping(kind: ImportKind, headers: string[], sampleRows: string[][]): Promise<Mapping> {
  const fields = FIELDS[kind]
  const keys = fields.map(f => f.key)
  if (!headers.length) return Object.fromEntries(keys.map(k => [k, null]))

  const fieldList = fields.map(f => `- ${f.key}: ${f.label}`).join('\n')
  const samples = sampleRows.slice(0, 4)
    .map(r => headers.map((h, i) => `${h}=${String(r[i] ?? '').slice(0, 40)}`).join(' | '))
    .join('\n')

  const system = 'You map spreadsheet columns to a fixed set of CRM fields. Reply with ONLY a JSON object whose keys are the field keys and whose values are the EXACT matching column header string, or null when no column fits. Never invent headers, never add keys.'
  const user =
    `Fields to fill:\n${fieldList}\n\n` +
    `Spreadsheet headers: ${JSON.stringify(headers)}\n\n` +
    `Sample rows:\n${samples || '(none)'}\n\n` +
    `Return JSON with a value (a header from the list, or null) for every field key.`

  let raw = ''
  try {
    raw = await chat(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0, max_tokens: 2000 },
    )
  } catch {
    return Object.fromEntries(keys.map(k => [k, null]))   // AI down → empty mapping, user maps manually
  }
  return sanitizeMapping(raw, keys, headers)
}

// Keep only our field keys, and only values that are real headers (or null).
export function sanitizeMapping(raw: string, keys: string[], headers: string[]): Mapping {
  const mapping: Mapping = Object.fromEntries(keys.map(k => [k, null]))
  let obj: Record<string, unknown> = {}
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) obj = JSON.parse(m[0])
  } catch { /* leave empty */ }
  const headerSet = new Set(headers)
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && headerSet.has(v)) mapping[k] = v
  }
  return mapping
}
