-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1: AI Matching Feature — Database Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Status fields (safe — won't error if column already exists)
ALTER TABLE "Properties"
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';    -- active | sold | rented | inactive

ALTER TABLE client_requests
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';    -- active | closed | paused

-- 2. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 3. Embedding columns
ALTER TABLE "Properties"
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

ALTER TABLE client_requests
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 4. Matches table
CREATE TABLE IF NOT EXISTS matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       bigint  NOT NULL REFERENCES "Companies"(id) ON DELETE CASCADE,
  property_id      bigint  NOT NULL REFERENCES "Properties"(id) ON DELETE CASCADE,
  client_id        bigint  NOT NULL REFERENCES client_requests(id) ON DELETE CASCADE,
  score            numeric(5,2) NOT NULL,        -- 0.00 – 100.00 overall
  budget_score     numeric(5,2) DEFAULT 0,
  location_score   numeric(5,2) DEFAULT 0,
  type_score       numeric(5,2) DEFAULT 0,
  bedroom_score    numeric(5,2) DEFAULT 0,
  amenity_score    numeric(5,2) DEFAULT 0,
  status           text DEFAULT 'new',           -- new | presented | interested | rejected
  created_at       timestamptz DEFAULT now()
);

-- Prevent duplicate match pairs
ALTER TABLE matches
  ADD CONSTRAINT unique_match UNIQUE (property_id, client_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS matches_property_idx ON matches(property_id);
CREATE INDEX IF NOT EXISTS matches_client_idx   ON matches(client_id);
CREATE INDEX IF NOT EXISTS matches_company_idx  ON matches(company_id);

-- 5. Row-level security
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON matches
  USING (company_id::text = current_setting('app.current_company_id', true));

-- Fast vector similarity search helper (used in Edge Functions)
-- SELECT * FROM properties WHERE company_id = $1 AND status = 'active'
-- ORDER BY embedding <=> $2 LIMIT 25;
