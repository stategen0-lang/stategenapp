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
    // Drop EVERYTHING that isn't a valid domain character. This is the important
    // one: it removes invisible junk that survives a trim — non-breaking spaces,
    // zero-width spaces, BOMs — which is how two identical-LOOKING domains fail an
    // exact match ("no company found" for a domain that's clearly in the table).
    .replace(/[^a-z0-9.-]/g, '')
}
