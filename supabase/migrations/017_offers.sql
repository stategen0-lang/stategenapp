-- Offer & negotiation tracking. Each row is one round of a negotiation on a
-- deal (which already links a client + property + agent). The "current state"
-- of a negotiation is derived from its rounds — no duplicated fields to sync.
create table if not exists offers (
  id          uuid primary key default gen_random_uuid(),
  company_id  bigint not null references "Companies"(id) on delete cascade,
  deal_id     uuid   not null references deals(id) on delete cascade,
  amount      numeric not null,
  side        text   not null check (side in ('buyer','owner')),
  status      text   not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  note        text,
  created_by  text,   -- agent_code who logged it
  created_at  timestamptz default now()
);

create index if not exists offers_deal_idx    on offers(deal_id, created_at);
create index if not exists offers_company_idx on offers(company_id);

-- RLS on, permissive policy — same posture as deals/stage_history: the app
-- enforces company scoping in code (service-role writes, getSession reads).
alter table offers enable row level security;
drop policy if exists offers_authenticated_full on offers;
create policy offers_authenticated_full on offers
  for all to authenticated using (true) with check (true);
