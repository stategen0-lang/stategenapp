-- Why an alert was raised.
--
-- Until now every row in listing_alerts meant the same thing: "a new listing
-- fits this client". Price-drop alerts say something different — "a listing you
-- were already shown, or one that was out of reach, is now within this client's
-- budget" — and an agent must be able to tell the two apart at a glance, so the
-- reason is stored rather than inferred.
--
-- old_price is what the listing cost before the cut, kept so the alert can show
-- the move ("$480,000 → $450,000") without reading the history table.
--
-- Safe to run more than once. Existing rows are all new-listing alerts, which is
-- exactly what the default says.

alter table listing_alerts
  add column if not exists reason text not null default 'new';

alter table listing_alerts
  add column if not exists old_price numeric;

-- 'new' | 'price_drop'. A check rather than an enum: adding the next reason
-- should be one migration, not a type rewrite.
alter table listing_alerts drop constraint if exists listing_alerts_reason_check;
alter table listing_alerts
  add constraint listing_alerts_reason_check check (reason in ('new', 'price_drop'));
