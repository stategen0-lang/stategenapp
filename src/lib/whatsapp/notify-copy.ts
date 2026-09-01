// Copy for the "you have a new client" WhatsApp nudge sent to the OWNING AGENT
// (never the client — the bot only ever messages agents). Pure and dependency-
// free so it unit-tests in isolation and can feed either a template body param
// or a plain-text send.

export interface NewClientInfo {
  name: string
  phone?: string | null
  type?: string | null          // "Buyer" | "Renter"
  budget?: number | null
  location?: string | null
}

function money(n: number | null | undefined, renter: boolean): string {
  if (!n || n <= 0) return ''
  if (renter) return `$${n.toLocaleString('en-US')}/mo`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n}`
}

/** One-line notification body. Single line (Meta template body params reject
 *  newlines) and kept well under the 1024-char template limit. */
export function newClientLine(c: NewClientInfo): string {
  const renter = String(c.type ?? '').toLowerCase().startsWith('rent')
  const bits: string[] = []
  const type = (c.type ?? '').trim()
  if (type) bits.push(type)
  const m = money(c.budget, renter)
  if (m) bits.push(m)
  const loc = (c.location ?? '').trim()
  if (loc) bits.push(`in ${loc}`)
  const detail = bits.length ? ` — ${bits.join(', ')}` : ''
  const phone = (c.phone ?? '').trim()
  const contact = phone ? ` (${phone})` : ''
  const name = (c.name ?? '').trim() || 'A new client'
  const line = `New client for you: ${name}${contact}${detail}. Please reach out to introduce yourself.`
  // Collapse any whitespace (incl. newlines from a pasted name) to single spaces
  // — Meta rejects template body params that contain newlines/tabs.
  return line.replace(/\s+/g, ' ').trim()
}
