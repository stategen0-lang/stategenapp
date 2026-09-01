-- Single-use agent invite links.
--
-- A manager generates a link (/join/<token>); the FIRST agent to accept it is
-- created auto-approved and the invite is consumed (used_at set), so the link
-- can never be used again. Optional expires_at adds a time limit on top.
create table if not exists invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  company_id  bigint not null references "Companies"(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  used_at     timestamptz,          -- null = still valid; set once consumed
  used_by     uuid
);

-- Fast lookup of a company's live (unused) invites.
create index if not exists invites_company_live_idx
  on invites (company_id) where used_at is null;

-- Only the service-role client (the API) ever touches this table; enabling RLS
-- with no policies keeps invite tokens unreadable to anon/authenticated clients.
alter table invites enable row level security;
