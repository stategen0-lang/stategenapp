-- Manager approval for new agents.
--
-- Agents sign up under their agency's domain but stay inactive until a manager
-- approves them, so a leaked domain can't let strangers into company data.
--
-- Backfill: every existing account is marked approved so this never locks out
-- current users. New agents default to false; managers/owners are set true at
-- signup.

alter table "Profiles" add column if not exists approved boolean not null default false;

-- Everyone who already exists keeps their access.
update "Profiles" set approved = true where approved = false;
