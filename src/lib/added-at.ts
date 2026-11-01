// When a record was added, as shown at the top of a client or listing.
//
// Always Beirut time, whatever zone the phone or the server is in: the stored
// value is UTC, and a client added at 1am would otherwise read as the day before.

const ADDED_AT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Beirut',
  day: 'numeric', month: 'short', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
})

/** "1 Nov 2026, 3:42 pm" — or '' for a record that has no date to show. */
export function formatAddedAt(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : ADDED_AT.format(d)
}
