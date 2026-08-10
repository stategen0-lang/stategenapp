-- 013 · WhatsApp Cloud API cutover (Twilio → Meta, go-direct)
--
-- The only schema change the migration needs: a place to record Meta's message
-- id so at-least-once webhook delivery can't process the same message twice.
-- All business logic (intent, flows, pairing, writes, pipeline, reminders) is
-- unchanged — this is a transport swap.

alter table whatsapp_logs
  add column if not exists wa_message_id text;

-- Dedupe lookups hit this on every inbound webhook; a partial index keeps it
-- small (outbound rows and pre-cutover rows have no id).
create index if not exists whatsapp_logs_wa_message_id_idx
  on whatsapp_logs(wa_message_id)
  where wa_message_id is not null;
