// One canonical form for an agency domain, so a company and its agents always
// resolve to the same string no matter how each person typed it.
//
// "https://www.EquityPropertiesLB.com/", "www.equitypropertieslb.com",
// "equitypropertieslb.com " → all become "equitypropertieslb.com".
//
// Pure and unit-tested. Used on every write (company signup, admin-create) and
// every read (agent signup lookup) so mismatched capitalisation / www / protocol
// can never split an agency from its agents.
export function normalizeDomain(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .replace(/^https?:\/\//, '')   // strip protocol
    .replace(/^@/, '')             // a stray leading @ (typed like an email)
    .replace(/^www\./, '')         // strip www.
    .replace(/[/?#].*$/, '')       // strip any path / query / fragment
    .replace(/\.+$/, '')           // strip trailing dot(s)
    .replace(/\s+/g, '')           // no internal spaces
}
