-- 015 · Per-agent daily-reminder time
--
-- Each agent chooses the hour (in the agency's local time, Asia/Beirut) they want
-- their daily WhatsApp digest. The send-reminder cron now runs hourly and only
-- messages agents whose reminder_hour matches the current local hour. Default 9
-- (9am) — the old fixed schedule, so nobody's experience changes until they pick.

alter table "Profiles"
  add column if not exists reminder_hour smallint not null default 9
  check (reminder_hour >= 0 and reminder_hour <= 23);
