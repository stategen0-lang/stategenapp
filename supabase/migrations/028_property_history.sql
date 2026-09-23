-- Price and status changes on a listing.
--
-- The activity feed is otherwise derived entirely from live tables, which means
-- it can only ever report what was CREATED. The two things a manager most wants
-- to see — a price moving and a listing going to Reserved or Sold — leave no
-- trace once the row is overwritten, so they are recorded here as they happen.
--
-- Deliberately not a general audit log: one row per meaningful change, written
-- by the API when it already has the old and the new value in hand.

create table if not exists property_history (
  id          bigserial primary key,
  company_id  bigint not null,
  property_id bigint not null,
  -- 'price' | 'rent' | 'status'
  field       text   not null,
  old_value   text,
  new_value   text,
  -- Who made the change, as an agent_code, so the feed can attribute it.
  agent_code  text,
  changed_at  timestamptz not null default now()
);

-- The feed reads one company's recent changes, newest first.
create index if not exists property_history_company_time
  on property_history (company_id, changed_at desc);

-- The listing sheet can show its own history later without a scan.
create index if not exists property_history_property
  on property_history (property_id, changed_at desc);

alter table property_history enable row level security;

-- Written by the service role only (the API decides what counts as a change);
-- read back through the same admin client that builds the feed.
drop policy if exists property_history_service on property_history;
create policy property_history_service on property_history
  for all to service_role using (true) with check (true);
