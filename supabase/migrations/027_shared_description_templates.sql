-- The agency's AI description templates, shared by everyone in it.
--
-- They used to live in the browser that created them (localStorage), so a
-- manager's house style never reached their agents — the reason the feature
-- looked broken for the agency testing the app. Stored as a JSON array of
-- { id, name, body, active }. description_template (the active body, used by the
-- WhatsApp bot) is kept in step by the API. Safe to re-run.
alter table "Companies" add column if not exists description_templates text;
