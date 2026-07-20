// List ordering: an agent's own records come first, then the rest of the
// company's. Kept pure so it can be unit-tested and reused for any list that
// carries an owning agent code.

/**
 * Stable partition — own items first (in their existing order), then everyone
 * else (also in their existing order). Managers have no agent code and own
 * nothing directly, so their list is returned unchanged.
 */
export function sortOwnFirst<T extends { agentId?: string | null }>(
  items: T[],
  agentCode: string | null | undefined,
): T[] {
  if (!agentCode) return [...items]
  const own: T[] = []
  const rest: T[] = []
  for (const item of items) {
    (item.agentId === agentCode ? own : rest).push(item)
  }
  return [...own, ...rest]
}
