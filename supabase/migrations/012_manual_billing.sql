-- Manual billing: the platform admin activates companies after an offline
-- payment (invoice + local transfer), instead of Stripe.
--
--   access_status : pending (signed up, no access yet) | active | expired | suspended
--   access_until  : date access is paid through; null while pending
--
-- Backfill: existing companies are marked active with a far-future date so no
-- current customer is locked out when the access gate ships.

alter table "Companies"
  add column if not exists access_status text not null default 'pending',
  add column if not exists access_until  timestamptz;

update "Companies"
  set access_status = 'active',
      access_until  = '2100-01-01'
  where access_status = 'pending';

-- ── Invoices ─────────────────────────────────────────────────────────────────
-- One row per billing period the admin raises for a company.
create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  company_id   bigint not null references "Companies"(id) on delete cascade,
  number       text,                       -- human-readable, e.g. INV-2026-0007
  plan         text,                       -- team | business | unlimited
  amount       numeric not null default 0,
  currency     text not null default 'USD',
  period_start date,
  period_end   date,
  status       text not null default 'unpaid',   -- unpaid | paid | void
  method       text,                       -- bank transfer | cash | OMT | other
  note         text,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);

create index if not exists invoices_company_idx on invoices(company_id, created_at desc);

-- RLS on, permissive to authenticated (the app enforces admin/company scoping in
-- the API), matching the rest of this project's tables.
alter table invoices enable row level security;
drop policy if exists invoices_authenticated_full on public.invoices;
create policy invoices_authenticated_full
  on public.invoices for all to authenticated
  using (true) with check (true);
