-- ─────────────────────────────────────────────────────────────────────────────
-- Calendar — events owned by an agent or manager
-- ─────────────────────────────────────────────────────────────────────────────
-- Conventions follow the rest of this app, not the generic Supabase examples:
--
--   • company_id is bigint referencing "Companies", matching Properties and
--     client_requests. Not uuid.
--   • Ownership is profile_id (uuid → "Profiles") AND agent_code (text), the
--     same pair the pipeline and client lists use. agent_code is what the
--     manager filter and the per-agent colours key on; profile_id is the real
--     foreign key. Storing only one of them would fork identity again.
--   • RLS deliberately does NOT use current_setting('app.current_company_id').
--     Migration 002 exists to undo exactly that pattern — this app never sets
--     that GUC, so it locked every table. Access is scoped in code, and every
--     API route re-checks the session's company and role.
--
-- Safe to run more than once.

create table if not exists calendar_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  bigint not null references "Companies"(id) on delete cascade,
  profile_id  uuid   not null references "Profiles"(id) on delete cascade,
  agent_code  text,                       -- 'a1'..'aN'; null for managers
  title       text not null,
  notes       text,
  kind        text not null default 'meeting'
                check (kind in ('viewing', 'meeting', 'call', 'follow_up', 'other')),
  -- Instants, always stored UTC. all_day events still carry a start/end so a
  -- single ordering works for both; the UI hides the time when all_day.
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  all_day     boolean not null default false,
  location    text,
  -- Optional links to the records an event is about.
  client_id   bigint references client_requests(id) on delete set null,
  property_id bigint references "Properties"(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- An event that ends before it starts is never intentional.
  constraint calendar_events_time_order check (ends_at >= starts_at)
);

-- The two queries this table serves: "this company's month" and "one agent's
-- month". Both range-scan on starts_at.
create index if not exists calendar_events_company_idx on calendar_events(company_id, starts_at);
create index if not exists calendar_events_profile_idx on calendar_events(profile_id, starts_at);
create index if not exists calendar_events_agent_idx   on calendar_events(company_id, agent_code, starts_at);

-- Keep updated_at honest without relying on the caller.
create or replace function calendar_events_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists calendar_events_touch_trg on calendar_events;
create trigger calendar_events_touch_trg
  before update on calendar_events
  for each row execute function calendar_events_touch();

-- ── RLS — same rule the rest of the app uses ─────────────────────────────────
alter table calendar_events enable row level security;

drop policy if exists calendar_events_authenticated_full on public.calendar_events;
create policy calendar_events_authenticated_full
  on public.calendar_events for all to authenticated
  using (true) with check (true);
