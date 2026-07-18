-- ─────────────────────────────────────────────────────────────────────────────
-- Lead Scoring — Phase 2
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds the scoring columns to client_requests (this app's clients table).
-- Scores are computed by the app server (src/lib/score-engine.ts): behavior
-- 50% + profile fit 30% + agent rating 20%. Safe to run more than once.

alter table client_requests add column if not exists lead_score int default 0;
alter table client_requests add column if not exists agent_rating int default 3
  check (agent_rating between 1 and 5);
alter table client_requests add column if not exists score_updated_at timestamptz;
