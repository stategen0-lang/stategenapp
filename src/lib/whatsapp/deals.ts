// Pipeline language for the WhatsApp bot — mapping how an agent talks about a
// deal ("move Ahmed to negotiating", "mark him won", "what's in negotiation")
// onto concrete pipeline stages. Pure and unit-tested: no network, no database.

import { STAGES, type Stage, type Outcome } from '../pipeline.ts'

// Spoken words → a pipeline stage. Kept deliberately small and unambiguous;
// anything not here falls through to Grok rather than being guessed at.
const STAGE_WORDS: Record<string, Stage> = {
  lead: 'lead', leads: 'lead',
  contacted: 'contacted', contact: 'contacted',
  viewing: 'viewing', viewings: 'viewing', showing: 'viewing', showings: 'viewing',
  negotiating: 'negotiating', negotiation: 'negotiating', negotiate: 'negotiating',
  offer: 'negotiating', offers: 'negotiating',
  closed: 'closed', close: 'closed',
}

// Outcome words all imply the deal is closed.
const OUTCOME_WORDS: Record<string, Outcome> = {
  won: 'won', win: 'won', sold: 'won',
  lost: 'lost', lose: 'lost', dead: 'lost',
}

export interface DealTarget {
  stage: Stage
  /** 'won' | 'lost' when known; null clears it (any non-closed stage);
   *  undefined means "closed but which way?" — the caller must ask. */
  outcome?: Outcome | undefined
}

const LABEL: Record<Stage, string> = Object.fromEntries(STAGES.map(s => [s.id, s.label])) as Record<Stage, string>

export function stageLabel(stage: Stage): string {
  return LABEL[stage] ?? stage
}

/** Human-readable target, e.g. "Negotiating" or "Closed (won)". */
export function targetLabel(t: DealTarget): string {
  if (t.stage === 'closed' && t.outcome) return `Closed (${t.outcome})`
  return stageLabel(t.stage)
}

/**
 * Map a single spoken word to a pipeline target.
 *   won/lost/sold → closed with that outcome
 *   closed/close  → closed, outcome unknown (caller asks won or lost)
 *   any stage     → that stage, outcome cleared (null)
 * Returns null for anything unrecognised.
 */
export function coerceDealTarget(word: string | null | undefined): DealTarget | null {
  if (!word) return null
  const w = word.trim().toLowerCase()
  if (OUTCOME_WORDS[w]) return { stage: 'closed', outcome: OUTCOME_WORDS[w] }
  const stage = STAGE_WORDS[w]
  if (!stage) return null
  if (stage === 'closed') return { stage: 'closed', outcome: undefined }   // ask won/lost
  return { stage, outcome: null }
}

/**
 * Find a stage a read query is asking to filter by ("what's in negotiation",
 * "show me viewings"). Scans for the first recognised stage/outcome word.
 * Returns the stage, or null to mean "the whole pipeline".
 */
export function findStageInText(text: string | null | undefined): Stage | null {
  const words = (text ?? '').toLowerCase().match(/[a-z]+/g) ?? []
  for (const w of words) {
    if (OUTCOME_WORDS[w]) return 'closed'
    if (STAGE_WORDS[w]) return STAGE_WORDS[w]
  }
  return null
}
