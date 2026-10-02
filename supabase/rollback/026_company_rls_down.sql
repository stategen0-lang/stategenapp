-- Undo of supabase/migrations/026_company_rls.sql — puts the original
-- "any authenticated user, all rows" policies back. Only for an emergency:
-- it re-opens the cross-agency hole. Not in migrations/ on purpose, so it is
-- never run by accident.

do $$
declare t text;
begin
  foreach t in array array[
    'Properties', 'calendar_events', 'client_requests', 'company_areas',
    'conversation_state', 'deals', 'listing_alerts', 'offers',
    'pending_actions', 'reminder_schedule', 'whatsapp_logs',
    'invoices', 'stage_history', 'Companies', 'Profiles'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_company', t);
    execute format('drop policy if exists %I on public.%I', t || '_company_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_full', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_full', t);
  end loop;
end $$;

drop function if exists public.current_company_id();
