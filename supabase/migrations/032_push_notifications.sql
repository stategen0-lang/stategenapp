-- Phone notifications.
--
-- A browser push subscription is per DEVICE, not per person: the same agent on
-- a phone and a laptop has two, and turning notifications off on one must not
-- silence the other. So the row is the device, and the switch in Settings is
-- simply whether a row exists for the device in front of you.
--
-- Nothing here stores a message. The payload is built and sent at the moment
-- something happens; this table only answers "where do I send it".
--
-- Safe to run more than once.

create table if not exists push_subscriptions (
  id          bigserial primary key,
  company_id  bigint not null references "Companies"(id) on delete cascade,
  -- Who the device belongs to. agent_code is carried alongside so the sender
  -- can go straight from "this alert is for NH-1" to an endpoint without a
  -- second lookup.
  profile_id  uuid   not null,
  agent_code  text,
  -- The push service's address for this device, plus the two keys its payload
  -- is encrypted with. Opaque to us.
  endpoint    text   not null,
  p256dh      text   not null,
  auth        text   not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- One row per device. Re-subscribing the same browser updates the keys rather
-- than leaving a second, stale endpoint that would double every notification.
create unique index if not exists push_subscriptions_endpoint_uniq
  on push_subscriptions (endpoint);

-- The send path: "every device belonging to this agent in this company".
create index if not exists push_subscriptions_agent
  on push_subscriptions (company_id, agent_code);

alter table push_subscriptions enable row level security;

-- Written and read by the service role only — the API decides whose device a
-- subscription belongs to, and nothing client-side should be able to enumerate
-- other people's endpoints.
drop policy if exists push_subscriptions_service on push_subscriptions;
create policy push_subscriptions_service on push_subscriptions
  for all to service_role using (true) with check (true);

-- ── A third kind of alert ───────────────────────────────────────────────────
-- 'new_client': an agent added a client whose brief fits somebody else's
-- listing. The existing two are a new listing and a price drop.
alter table listing_alerts drop constraint if exists listing_alerts_reason_check;
alter table listing_alerts
  add constraint listing_alerts_reason_check
  check (reason in ('new', 'price_drop', 'new_client'));
