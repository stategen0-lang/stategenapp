-- ─────────────────────────────────────────────────────────────────────────────
-- Manager / Agent roles
-- ─────────────────────────────────────────────────────────────────────────────
-- Links a login (Profiles row) to the agent code ('a1'..'a4') that clients,
-- properties and deals are tagged with, so the server can tell what a signed-in
-- user owns.
--
--   role 'owner' | 'manager' → sees everything, can filter by agent
--   role 'agent'             → own clients/deals only; other agents' clients
--                              are visible but name+phone masked
--
-- Safe to run more than once.

alter table "Profiles" add column if not exists agent_code text;

-- Managers don't need an agent code; agents must have one.
create index if not exists profiles_agent_code_idx on "Profiles"(agent_code);

-- The existing seeded login stays a manager.
update "Profiles" set role = 'owner' where role is null;
