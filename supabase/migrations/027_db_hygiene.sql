-- ─────────────────────────────────────────────────────────────────────────────
-- Database hygiene (from Supabase's security advisor)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Three trigger functions had no pinned search_path, so they resolved names
--    through whatever path the caller had. Pin it.
-- 2. rls_auto_enable() is the event-trigger function that switches on row-level
--    security for every new table. It was also callable by anyone through the
--    REST API (/rest/v1/rpc/rls_auto_enable). The event trigger does not need
--    callers to hold EXECUTE, so close it off.
-- Safe to run more than once.

alter function public.create_deal_for_client() set search_path = public, pg_temp;
alter function public.log_stage_change()       set search_path = public, pg_temp;
alter function public.calendar_events_touch()  set search_path = public, pg_temp;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
