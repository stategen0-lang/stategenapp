-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: "infinite recursion detected in policy for relation Profiles" (42P17)
-- ─────────────────────────────────────────────────────────────────────────────
-- Some Row-Level-Security policies (created in the Supabase dashboard, not in
-- these migrations) referenced the Profiles table from within Profiles' own
-- policy — and Companies / Properties / client_requests policies referenced
-- Profiles too. That created an evaluation cycle, so EVERY one of these tables
-- returned HTTP 500 for the anon/authenticated roles and the app silently fell
-- back to demo data.
--
-- This resets those policies to simple, non-recursive rules:
--   • signed-in (authenticated) users  -> full read/write access
--   • anonymous users                  -> no access
--
-- That matches the app's current single-tenant / prototype data model (API
-- routes use a fixed company_id). Per-company isolation can be layered on later
-- once every read is scoped to the logged-in user. The service_role key always
-- bypasses RLS, so server-side admin/seed scripts are unaffected.
--
-- Safe to run more than once.

do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array['Profiles', 'Companies', 'Properties', 'client_requests']
  loop
    -- Drop every existing policy on the table (their names are unknown here).
    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;

    -- Ensure RLS is enabled, then add one clean, non-recursive policy.
    execute format('alter table public.%I enable row level security', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      tbl || '_authenticated_full', tbl
    );
  end loop;
end $$;
