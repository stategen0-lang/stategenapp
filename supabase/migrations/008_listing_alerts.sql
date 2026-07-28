-- ─────────────────────────────────────────────────────────────────────────────
-- New-listing match alerts
-- ─────────────────────────────────────────────────────────────────────────────
-- When a property is added, the matching engine finds clients who fit and a row
-- is written here for each, aimed at the client's owning agent. An agent sees
-- their own alerts; a manager sees the whole company's.
--
-- Conventions follow the rest of this app (see 006/007): bigint company_id
-- referencing "Companies", ownership by agent_code + client, and the plain
-- authenticated RLS policy — NOT the current_setting() pattern migration 002
-- exists to undo.
--
-- Safe to run more than once.

create table if not exists listing_alerts (
  id          uuid primary key default gen_random_uuid(),
  company_id  bigint not null references "Companies"(id) on delete cascade,
  property_id bigint references "Properties"(id) on delete cascade,
  client_id   bigint references client_requests(id) on delete cascade,
  agent_code  text,                          -- who the alert is for; null = unassigned client
  score       int not null default 0,        -- match percentage, 0-100
  seen        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- One alert per (listing, client): re-inserting the same pairing is a no-op,
-- so re-saving a property can't spawn duplicate alerts.
create unique index if not exists listing_alerts_prop_client_uniq
  on listing_alerts(property_id, client_id);

-- The two reads: "this company's alerts, newest first" and "this agent's
-- unseen count".
create index if not exists listing_alerts_company_idx on listing_alerts(company_id, created_at desc);
create index if not exists listing_alerts_agent_idx   on listing_alerts(agent_code, seen);

-- ── RLS — same rule the rest of the app uses ─────────────────────────────────
alter table listing_alerts enable row level security;

drop policy if exists listing_alerts_authenticated_full on public.listing_alerts;
create policy listing_alerts_authenticated_full
  on public.listing_alerts for all to authenticated
  using (true) with check (true);
