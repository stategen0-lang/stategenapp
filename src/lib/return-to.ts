// Where closing a detail view should put you.
//
// Listings and clients have no page of their own: they open as a modal over
// /properties or /clients, reached by ?open=<id>. That is fine when you were
// already on that list, but the activity feed, the pipeline board and a phone
// notification all link in from somewhere else — and closing the modal left you
// standing on the properties list, having lost your place in the feed you were
// reading.
//
// So a deep link can say where it came from, and the modal's close button goes
// back there instead of merely hiding itself.

/**
 * A `from` value, accepted only if it is a path inside this app.
 *
 * It arrives in a URL, so anyone can put anything in it and it ends up in
 * router.push(). Allowing "//evil.example.com" or "https://…" would turn every
 * listing link into an open redirect — a believable one, since it would be sent
 * as a stategen.app address.
 */
export function returnTo(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s.startsWith('/')) return null        // relative or absolute URL — not ours
  if (s.startsWith('//')) return null        // protocol-relative: //host/path
  if (/[\\]/.test(s)) return null            // some browsers read a backslash as "/"
  if (s.includes('://')) return null
  if (s.length > 300) return null
  return s
}

/** Add a return path to a deep link: withReturn('/properties?open=7', '/activity'). */
export function withReturn(href: string, from: string | null | undefined): string {
  const to = returnTo(from)
  if (!to) return href
  return `${href}${href.includes('?') ? '&' : '?'}from=${encodeURIComponent(to)}`
}
