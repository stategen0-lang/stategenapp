// Building the list of agents a manager can filter by.
//
// This used to be the hardcoded demo AGENTS array, which had two consequences
// once real agents existed:
//
//   • an agent missing from that list never appeared in the filter, so their
//     deals could not be isolated at all; and
//   • the lookup fell back to AGENTS[0], so their cards were displayed under
//     the first demo agent's name and colour — silently attributing one agent's
//     deals to another.
//
// The roster is therefore derived from the data: every agent code that has a
// profile, plus every code that actually appears on a deal. Pure, so the
// derivation is testable without a database.

export interface RosterAgent {
  id: string          // agent_code, e.g. 'a2'
  name: string
  initials: string
  color: string
  /** True when no Profile row exists for this code — data without an owner. */
  orphan?: boolean
}

// Deliberately fixed and ordered: a given code keeps the same colour between
// sessions, so managers build muscle memory for who is who on the board.
const PALETTE = ['#5E8FD6', '#1F8A5B', '#9A6516', '#A23434', '#6B4FA8', '#0F7B8A', '#B3541E', '#4A6274']

export function colorFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

/** "Rami Saad (Agent)" -> "RS"; falls back to the code when there's no name. */
export function initialsOf(name: string, fallbackId = '?'): string {
  const words = (name ?? '')
    .replace(/\([^)]*\)/g, ' ')      // drop role suffixes like "(Agent)"
    .split(/\s+/)
    .filter(w => /[A-Za-zÀ-ÿ]/.test(w))
  if (!words.length) return fallbackId.slice(0, 2).toUpperCase()
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** Strip a trailing role label so the filter reads "Rami Saad", not "Rami Saad (Agent)". */
export function displayName(name: string): string {
  return (name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export interface ProfileLike { agent_code: string | null; Full_name: string | null }
export interface KnownAgent { id: string; name: string; initials?: string; color?: string }

/**
 * Combine real profiles with the agent codes present on deals.
 *
 * `known` supplies presentation details (colour, initials) for codes the app
 * already ships styling for; anything else gets a derived colour so it is still
 * visually distinct rather than colliding with an existing agent.
 */
export function buildRoster(
  profiles: ProfileLike[],
  dealAgentIds: (string | null | undefined)[],
  known: KnownAgent[] = [],
): RosterAgent[] {
  const byCode = new Map<string, RosterAgent>()

  for (const p of profiles) {
    if (!p.agent_code) continue
    const k = known.find(a => a.id === p.agent_code)
    const name = displayName(p.Full_name ?? '') || k?.name || p.agent_code
    byCode.set(p.agent_code, {
      id: p.agent_code,
      name,
      initials: k?.initials ?? initialsOf(name, p.agent_code),
      color: k?.color ?? colorFor(p.agent_code),
    })
  }

  // Codes that appear on deals but have no profile: still filterable, and
  // labelled honestly rather than shown as somebody else.
  for (const id of dealAgentIds) {
    if (!id || byCode.has(id)) continue
    const k = known.find(a => a.id === id)
    byCode.set(id, {
      id,
      name: k?.name ?? id,
      initials: k?.initials ?? initialsOf(k?.name ?? '', id),
      color: k?.color ?? colorFor(id),
      orphan: !k,
    })
  }

  const roster = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name))

  // Colour identifies the agent on the board, so two agents sharing one is a
  // real ambiguity — and an 8-entry palette collides readily (a9 hashes to the
  // same slot as a1). Resolve within the roster: agents the app ships colours
  // for keep theirs, everyone else takes the next free slot. Deterministic,
  // because the roster is sorted before this runs.
  const taken = new Set(roster.filter(a => known.some(k => k.id === a.id && k.color)).map(a => a.color))
  for (const agent of roster) {
    if (known.some(k => k.id === agent.id && k.color)) continue
    if (!taken.has(agent.color)) { taken.add(agent.color); continue }
    const free = PALETTE.find(c => !taken.has(c))
    // Every slot used: keep the hashed colour rather than inventing one.
    if (free) agent.color = free
    taken.add(agent.color)
  }

  return roster
}

/**
 * Look up an agent for display. Returns null rather than defaulting to the
 * first agent — showing a deal under the wrong person's name is worse than
 * showing it under none.
 */
export function findAgent(roster: RosterAgent[], id: string | null | undefined): RosterAgent | null {
  if (!id) return null
  return roster.find(a => a.id === id) ?? null
}

/** Placeholder for a deal whose agent can't be resolved. */
export function unknownAgent(id: string | null | undefined): RosterAgent {
  return { id: id ?? '', name: id ? `Unassigned (${id})` : 'Unassigned', initials: '—', color: '#9AA3B2', orphan: true }
}
