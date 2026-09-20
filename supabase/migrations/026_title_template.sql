-- The agency's listing-title pattern, e.g.
--   [furnished or nothing][size][type][for sale/ rent][location]
-- Set by a manager in Settings; the New Listing form and the WhatsApp bot write
-- each title from it. Null = use the app's default pattern. Safe to re-run.
alter table "Companies" add column if not exists title_template text;
