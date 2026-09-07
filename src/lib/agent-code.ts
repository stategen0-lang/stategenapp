// The short agent ID used as the local part of an agent's synthetic login email
// (<code>@<domain>). Initials from the name + a random 3-digit number, e.g.
// "JD-421". Pure and dependency-free so it runs on the client (the signup page)
// and the server (invite accept / manager-create) alike, and unit-tests cleanly.
export function generateAgentCode(fullName: string): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  const num = Math.floor(100 + Math.random() * 900)
  if (!parts.length) return `AG-${num}`
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase()
  return `${initials}-${num}`
}
