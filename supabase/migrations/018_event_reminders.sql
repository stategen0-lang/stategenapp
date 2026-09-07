-- Pre-event WhatsApp reminders ("⏰ In ~30 min: viewing with Joe…").
-- reminded_at marks an event as already nudged so the 15-minute cron fires once.
alter table calendar_events add column if not exists reminded_at timestamptz;

-- Only unreminded upcoming events are ever scanned.
create index if not exists calendar_events_reminder_idx
  on calendar_events (starts_at) where reminded_at is null;
