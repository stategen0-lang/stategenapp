-- ─────────────────────────────────────────────────────────────────────────────
-- Company isolation at the database level
-- ─────────────────────────────────────────────────────────────────────────────
-- Until now every table had ONE policy: "any authenticated user, all rows".
-- The app's own API routes filter by company_id, but Supabase also exposes the
-- tables directly (PostgREST) with the public anon key — so any signed-in user
-- of ANY agency could read or change every other agency's clients, listings,
-- profiles and invoices by calling that API themselves. These policies make the
-- database enforce the boundary regardless of what the caller does.
--
-- Shape of the result:
--   • company-owned tables : full access to your OWN company's rows only
--   • Companies, invoices  : READ-ONLY, own row(s) only — plan, trial and
--                            payment state are changed by StateGen (service
--                            role), never by the agency itself
--   • Profiles             : read your own row + your company's; no writes
--                            (role / company / approval changes go through the
--                            server's service role)
--   • stage_history        : through the deal it belongs to
--   • invites, login_attempts, property_history: unchanged (service role only)
--
-- The service role (every admin-client call: signup, invites, WhatsApp bot,
-- cron, admin panel, imports of other agencies' data) bypasses RLS and is
-- unaffected.
--
-- Undo: supabase/rollback/026_company_rls_down.sql
-- Safe to run more than once.

-- The signed-in user's company. SECURITY DEFINER so it can read Profiles while
-- Profiles itself is protected by a policy that calls it (no recursion).
create or replace function public.current_company_id() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select company_id from public."Profiles" where id = auth.uid()
$$;

revoke all on function public.current_company_id() from public, anon;
grant execute on function public.current_company_id() to authenticated, service_role;

-- ── Company-owned tables: own rows only, read + write ────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'Properties', 'calendar_events', 'client_requests', 'company_areas',
    'conversation_state', 'deals', 'listing_alerts', 'offers',
    'pending_actions', 'reminder_schedule', 'whatsapp_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_full', t);
    execute format('drop policy if exists %I on public.%I', t || '_company', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (company_id = (select public.current_company_id())) '
      'with check (company_id = (select public.current_company_id()))',
      t || '_company', t);
  end loop;
end $$;

-- ── Read-only for agencies: their own company and their own invoices ─────────
drop policy if exists "Companies_authenticated_full" on public."Companies";
drop policy if exists "Companies_own_read" on public."Companies";
create policy "Companies_own_read" on public."Companies"
  for select to authenticated
  using (id = (select public.current_company_id()));

drop policy if exists "invoices_authenticated_full" on public.invoices;
drop policy if exists "invoices_company_read" on public.invoices;
create policy "invoices_company_read" on public.invoices
  for select to authenticated
  using (company_id = (select public.current_company_id()));

-- ── Profiles: read yourself + your company; never write from the client ──────
drop policy if exists "Profiles_authenticated_full" on public."Profiles";
drop policy if exists "Profiles_company_read" on public."Profiles";
create policy "Profiles_company_read" on public."Profiles"
  for select to authenticated
  using (id = (select auth.uid()) or company_id = (select public.current_company_id()));

-- ── stage_history has no company_id of its own: scope it through its deal ────
drop policy if exists "stage_history_authenticated_full" on public.stage_history;
drop policy if exists "stage_history_company" on public.stage_history;
create policy "stage_history_company" on public.stage_history
  for all to authenticated
  using (exists (select 1 from public.deals d where d.id = stage_history.deal_id and d.company_id = (select public.current_company_id())))
  with check (exists (select 1 from public.deals d where d.id = stage_history.deal_id and d.company_id = (select public.current_company_id())));
