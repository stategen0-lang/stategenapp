// ── Lead scoring engine (Phase 2) ────────────────────────────────────────────
// Pure, deterministic and explainable — per the spec's compliance note the
// score only uses behavior/engagement signals, never protected characteristics,
// and it only ever sorts/prioritises (nothing is hidden on a low score).
//
// Spec weights: behavior 50%, profile fit 30%, agent rating 20%.
//
// Adaptations to THIS app's data (no whatsapp_logs / property-view / matches
// tables exist):
//   • behavior = recency of last pipeline activity + stage changes in the last
//     14 days (stage_history). Response-speed has no data source yet, so
//     behavior blends recency 60% / engagement 40%.
//   • profile-fit timeline uses the client's status as the intent proxy
//     (Negotiation ≈ ready now, Viewing ≈ actively looking, Searching ≈ early).
//   • best-match strength is computed live with the matching engine instead of
//     a matches table.

export const SCORE_WEIGHTS = { behavior: 0.5, profileFit: 0.3, agentRating: 0.2 } as const

// ── Behavior (0-100) ─────────────────────────────────────────────────────────

// Last activity today = 100, fading linearly to 0 at 30+ days inactive.
export function recencyScore(daysSinceActivity: number): number {
  if (daysSinceActivity <= 0) return 100
  if (daysSinceActivity >= 30) return 0
  return Math.round(100 - (daysSinceActivity / 30) * 100)
}

// Pipeline events (stage changes) in the last 14 days, capped at 3.
export function engagementScore(recentEvents: number): number {
  const capped = Math.max(0, Math.min(3, recentEvents))
  return Math.round((capped / 3) * 100)
}

export function behaviorScore(daysSinceActivity: number, recentEvents: number): number {
  return Math.round(recencyScore(daysSinceActivity) * 0.6 + engagementScore(recentEvents) * 0.4)
}

// ── Profile fit (0-100) ──────────────────────────────────────────────────────

export function budgetClarityScore(budget: number): number {
  return budget > 0 ? 100 : 20
}

// Client status as the timeline/intent proxy (spec: ready now 100 → browsing 20).
export function timelineScore(status: string): number {
  switch (status) {
    case 'Negotiation': return 100
    case 'Signed':      return 100
    case 'Viewing':     return 70
    case 'Searching':   return 40
    default:            return 20
  }
}

export function profileFitScore(budget: number, status: string, bestMatchPct: number): number {
  const best = Math.max(0, Math.min(100, bestMatchPct))
  return Math.round((budgetClarityScore(budget) + timelineScore(status) + best) / 3)
}

// ── Agent rating (0-100) ─────────────────────────────────────────────────────

// 1-5 stars map straight to 20-100. Out-of-range input clamps to the default 3.
export function ratingScore(stars: number): number {
  const s = Number.isFinite(stars) && stars >= 1 && stars <= 5 ? Math.round(stars) : 3
  return s * 20
}

// ── Final score ──────────────────────────────────────────────────────────────

export function leadScore(behavior: number, profileFit: number, agentRating100: number): number {
  const clamp = (n: number) => Math.max(0, Math.min(100, n))
  return Math.round(
    clamp(behavior) * SCORE_WEIGHTS.behavior
    + clamp(profileFit) * SCORE_WEIGHTS.profileFit
    + clamp(agentRating100) * SCORE_WEIGHTS.agentRating,
  )
}

// ── Bands (color only — the agent always sees the raw number) ────────────────

export type ScoreBand = 'hot' | 'warm' | 'cold'

export function scoreBand(score: number): ScoreBand {
  if (score >= 70) return 'hot'
  if (score >= 40) return 'warm'
  return 'cold'
}

export const BAND_STYLE: Record<ScoreBand, { bg: string; color: string }> = {
  hot:  { bg: '#E3F4EA', color: '#1F7A4D' },  // green
  warm: { bg: '#FBEFD6', color: '#9A6516' },  // amber
  cold: { bg: '#F0F2F5', color: '#6A7488' },  // gray
}
