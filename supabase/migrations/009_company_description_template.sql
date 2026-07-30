-- Company-wide AI description template.
--
-- Description templates used to live only in each browser's localStorage, so the
-- server (and therefore the WhatsApp bot) had no way to know which template an
-- agency had chosen. This stores the company's active template body so
-- server-side description generation — the web route and the WhatsApp
-- "write a description for #23" flow — can reuse it.
--
-- One shared house-style template per company; null means "no template, write
-- free-form marketing copy".

alter table "Companies" add column if not exists description_template text;
