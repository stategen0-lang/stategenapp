-- Where "Send to marketing" delivers a listing. Set by a manager in Settings;
-- one or more comma-separated addresses (the team that posts listings on OLX,
-- Instagram, Facebook…). Null = feature not set up, so the app offers no send.
-- When a listing was last sent is kept in its Amenities JSON (marketingSentAt),
-- so no per-property column is needed.
alter table "Companies" add column if not exists marketing_email text;
