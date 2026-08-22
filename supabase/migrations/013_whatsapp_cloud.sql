-- 013 · WhatsApp Cloud API cutover (Twilio → Meta, go-direct)
--
-- The only schema change the migration needs: a place to record Meta's message
-- id so at-least-once webhook delivery can't process the same message twice.
-- All business logic (intent, flows, pairing, writes, pipeline, reminders) is
-- unchanged — this is a transport swap.

alter table whatsapp_logs
  add column if not exists wa_message_id text;

-- UNIQUE (partial) so the webhook can dedupe atomically: the second delivery of
-- the same Meta message id fails its insert with 23505 and is skipped, instead
-- of producing a duplicate reply. Partial (non-null only) so the many rows
-- without an id — outbound replies and pre-cutover rows — are unaffected.
create unique index if not exists whatsapp_logs_wa_message_id_uniq
  on whatsapp_logs(wa_message_id)
  where wa_message_id is not null;
