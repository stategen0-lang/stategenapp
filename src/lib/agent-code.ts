// The short agent ID used as the local part of an agent's synthetic login email
// (<code>@<domain>). Initials from the name + a random 3-digit number, e.g.
// "JD-421". Pure and dependency-free so it runs on the client (the signup page)
// and the server (invite accept / manager-create) alike, and unit-tests cleanly.
// Validate a manager-chosen agent ID. Codes double as the login-email local part
// (<code>@<domain>) and as the ownership key, so they must be simple: letters,
// digits and hyphens, 2–20 chars, starting alphanumeric. Returns the normalised
// (upper-cased) code, or null if it isn't usable.
export function sanitizeAgentCode(raw: string | null | undefined): string | null {
  const c = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(c)) return null
  return c
}

export function generateAgentCode(fullName: string): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const num = Math.floor(100 + Math.random() * 900)
  if (!parts.length) return `AG-${num}`
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase()
  return `${initials}-${num}`
}
