-- ─────────────────────────────────────────────────────────────────────────────
-- Deal Pipeline — Phase 1
-- ─────────────────────────────────────────────────────────────────────────────
-- Adapted from the build spec to THIS app's real schema:
--   • clients live in `client_requests` (bigint id) — there is no `clients` table
--   • Companies / Properties use bigint ids, not uuid
--   • there is no `agents` table — agents are codes ('a1'..'a4') kept in the
--     client's notes JSON, so agent_id is text
--   • RLS mirrors what every other table here uses (authenticated = full access);
--     the spec's current_setting('app.current_company_id') policy would block
--     everything because this app never sets that GUC.
-- Safe to run more than once.

-- ── deals ────────────────────────────────────────────────────────────────────
create table if not exists deals (
  id               uuid primary key default gen_random_uuid(),
  company_id       bigint not null references "Companies"(id) on delete cascade,
  client_id        bigint not null references client_requests(id) on delete cascade,
  agent_id         text,
  property_id      bigint references "Properties"(id) on delete set null,
  stage            text not null default 'lead'
                     check (stage in ('lead','contacted','viewing','negotiating','closed')),
  outcome          text check (outcome in ('won','lost')),
  value            numeric default 0,
  stage_changed_at timestamptz default now(),
  created_at       timestamptz default now()
);

-- One deal per client keeps the auto-create trigger idempotent.
create unique index if not exists deals_client_uniq on deals(client_id);
create index if not exists deals_company_idx on deals(company_id);
create index if not exists deals_stage_idx   on deals(stage);

-- ── stage_history ────────────────────────────────────────────────────────────
create table if not exists stage_history (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references deals(id) on delete cascade,
  from_stage text,
  to_stage   text not null,
  changed_at timestamptz default now()
);
create index if not exists stage_history_deal_idx on stage_history(deal_id);

-- ── RLS (same rule as the rest of the app) ───────────────────────────────────
alter table deals enable row level security;
alter table stage_history enable row level security;

drop policy if exists deals_authenticated_full on deals;
create policy deals_authenticated_full on deals
  for all to authenticated using (true) with check (true);

drop policy if exists stage_history_authenticated_full on stage_history;
create policy stage_history_authenticated_full on stage_history
  for all to authenticated using (true) with check (true);

-- ── Auto-create a Lead deal whenever a client is added ───────────────────────
create or replace function create_deal_for_client() returns trigger as $$
declare v_agent text := 'a1';
begin
  begin
    v_agent := coalesce(nullif(new.notes::jsonb ->> 'agentId', ''), 'a1');
  exception when others then
    v_agent := 'a1';   -- notes isn't JSON on older rows
  end;

  insert into deals (company_id, client_id, agent_id, stage, value, stage_changed_at)
  values (new.company_id, new.id, v_agent, 'lead', coalesce(new.budget_max, 0), now())
  on conflict (client_id) do nothing;

  return new;
end; $$ language plpgsql;

drop trigger if exists on_client_insert on client_requests;
create trigger on_client_insert after insert on client_requests
  for each row execute function create_deal_for_client();

-- ── Log every stage change + stamp stage_changed_at ──────────────────────────
create or replace function log_stage_change() returns trigger as $$
begin
  if new.stage is distinct from old.stage then
    insert into stage_history (deal_id, from_stage, to_stage) values (new.id, old.stage, new.stage);
    new.stage_changed_at := now();
  end if;
  return new;
end; $$ language plpgsql;

drop trigger if exists on_deal_stage_change on deals;
create trigger on_deal_stage_change before update on deals
  for each row execute function log_stage_change();

-- ── Backfill deals for existing clients (seed stage from their status) ───────
insert into deals (company_id, client_id, agent_id, stage, outcome, value, stage_changed_at)
select
  c.company_id,
  c.id,
  coalesce(nullif(case when c.notes ~ '^\s*\{' then (c.notes::jsonb ->> 'agentId') end, ''), 'a1'),
  case c.status
    when 'Viewing'     then 'viewing'
    when 'Negotiation' then 'negotiating'
    when 'Signed'      then 'closed'
    else 'lead'
  end,
  case when c.status = 'Signed' then 'won' end,
  coalesce(c.budget_max, 0),
  now()
from client_requests c
where not exists (select 1 from deals d where d.client_id = c.id);

-- ── Realtime: publish deals changes to subscribed clients ────────────────────
do $$ begin
  alter publication supabase_realtime add table deals;
exception when duplicate_object then null;
end $$;
