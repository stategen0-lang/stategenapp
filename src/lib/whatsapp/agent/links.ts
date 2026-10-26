// Every listing a search reply names comes with its link.
//
// The search tools return a link under each result, but the model drops them
// when it rewrites the list — "send me 130 sqm apartments in Achrafieh" came
// back with five listings and no links. So after a search turn, any listing the
// reply mentions without its link gets one, in a short block at the end.

/** Listing numbers mentioned in a reply, in order, without repeats. */
export function mentionedIds(reply: string): number[] {
  return [...new Set([...reply.matchAll(/#(\d{1,7})\b/g)].map(m => Number(m[1])))]
}

/**
 * The reply with links added for the listings it names but doesn't link.
 * `listingIds` are the ones that really are this agency's listings (a "#12"
 * can also be a client number). Pure, for tests.
 */
export function withListingLinks(reply: string, listingIds: Set<number>, origin: string, max = 10): string {
  if (!origin) return reply
  const missing = mentionedIds(reply)
    .filter(id => listingIds.has(id) && !reply.includes(`open=${id}`))
    .slice(0, max)
  if (!missing.length) return reply
  const lines = missing.map(id => `#${id} ${origin}/properties?open=${id}`)
  return `${reply.trimEnd()}\n\n${missing.length === 1 ? 'Link' : 'Links'}:\n${lines.join('\n')}`
}
