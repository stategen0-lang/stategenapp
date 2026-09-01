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

/** Just the client data — name, contact, and what they want — with NO sentence
 *  framing. This is the {{1}} value for the approved template, whose fixed text
 *  supplies the "New client for you — … reach out" wrapper (a Meta template
 *  variable may not sit at the start or end, so the framing must be literal). */
export function newClientCore(c: NewClientInfo): string {
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
  // Collapse whitespace (incl. newlines from a pasted name) — Meta rejects
  // template body params that contain newlines/tabs.
  return `${name}${contact}${detail}`.replace(/\s+/g, ' ').trim()
}

/** Full self-contained sentence — used for the free-text fallback (inside the
 *  24h window), where there is no template to supply the framing. */
export function newClientLine(c: NewClientInfo): string {
  return `New client for you: ${newClientCore(c)}. Please reach out to introduce yourself.`
}
