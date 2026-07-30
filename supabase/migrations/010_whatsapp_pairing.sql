-- Production WhatsApp connect/opt-in.
--
-- Once off the Twilio sandbox (Meta-verified sender), there's no "join <code>"
-- step to implicitly prove a phone belongs to an agent, and Meta requires
-- explicit, provable opt-in before the business messages anyone. So an agent
-- connects by texting a one-time pairing code to the bot (via a wa.me deep
-- link): the inbound message proves control of the number AND captures consent.
--
--   whatsapp_enabled        — pause the assistant without losing the pairing
--   whatsapp_opt_in_at      — when consent was captured (compliance record)
--   whatsapp_pending_code   — the outstanding pairing code (null once bound)
--   whatsapp_pending_expires— that code's expiry

alter table "Profiles"
  add column if not exists whatsapp_enabled boolean not null default true,
  add column if not exists whatsapp_opt_in_at timestamptz,
  add column if not exists whatsapp_pending_code text,
  add column if not exists whatsapp_pending_expires timestamptz;

-- The webhook looks a pairing code up across the company when an unknown number
-- texts "connect <code>".
create index if not exists idx_profiles_pending_code
  on "Profiles" (whatsapp_pending_code)
  where whatsapp_pending_code is not null;
