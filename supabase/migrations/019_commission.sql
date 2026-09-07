-- Per-deal commission split. Default 2.5% agent + 2.5% company (5% total); a
-- deal can be adjusted afterward (e.g. co-broker split) from the analytics page.
alter table deals add column if not exists agent_commission_pct   numeric not null default 2.5;
alter table deals add column if not exists company_commission_pct numeric not null default 2.5;
