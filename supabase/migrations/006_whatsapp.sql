-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp bot — Phase 1 foundation
-- ─────────────────────────────────────────────────────────────────────────────
-- Adapted from the build spec to THIS app's real schema:
--
--   • No `agents` table is created. Identity already lives in "Profiles"
--     (company_id, role, agent_code) and the manager/agent permission system is
--     built on it — a parallel agents table would fork identity in two, which is
--     the same bug class as the hardcoded mock user we removed. Instead the
--     WhatsApp number becomes another identity key ON Profiles.
--
--   • company_id already exists on "Properties" and client_requests (bigint),
--     so the spec's "add company_id first" step is already done. Foreign keys
--     here are bigint, not uuid.
--
--   • RLS deliberately does NOT use the spec's
--     `current_setting('app.current_company_id')::uuid` policy. That is exactly
--     the pattern migration 002 exists to undo — this app never sets that GUC,
--     so it locked every table and the site silently fell back to demo data.
--     These tables use the same authenticated policy as the rest of the app;
--     the webhook itself runs with the service role (no user session) and scopes
--     every query by company in code.
--
-- Safe to run more than once.

-- ── WhatsApp identity on the existing profile ────────────────────────────────
alter table "Profiles" add column if not exists whatsapp_number text;

-- One number identifies exactly one agent. Stored E.164 ("+9613123456").
create unique index if not exists profiles_whatsapp_number_uniq
  on "Profiles"(whatsapp_number) where whatsapp_number is not null;

-- ── Message log (every inbound + outbound) ───────────────────────────────────
create table if not exists whatsapp_logs (
  id         uuid primary key default gen_random_uuid(),
  company_id bigint references "Companies"(id) on delete cascade,
  profile_id uuid references "Profiles"(id) on delete set null,
  from_number text,
  direction  text not null check (direction in ('inbound', 'outbound')),
  message    text,
  intent     text,
  created_at timestamptz default now()
);
create index if not exists whatsapp_logs_profile_idx on whatsapp_logs(profile_id, created_at desc);
create index if not exists whatsapp_logs_company_idx on whatsapp_logs(company_id, created_at desc);

-- ── Multi-step flow state (one live flow per agent) ──────────────────────────
create table if not exists conversation_state (
  id           uuid primary key default gen_random_uuid(),
  company_id   bigint references "Companies"(id) on delete cascade,
  profile_id   uuid not null references "Profiles"(id) on delete cascade,
  current_flow text,
  step         text,
  context      jsonb default '{}'::jsonb,
  updated_at   timestamptz default now()
);
create unique index if not exists conversation_state_profile_uniq on conversation_state(profile_id);

-- ── Writes awaiting "yes" (the spec's confirm-before-write rule) ─────────────
create table if not exists pending_actions (
  id          uuid primary key default gen_random_uuid(),
  company_id  bigint references "Companies"(id) on delete cascade,
  profile_id  uuid not null references "Profiles"(id) on delete cascade,
  action_type text not null,
  summary     text,
  payload     jsonb not null default '{}'::jsonb,
  expires_at  timestamptz not null default (now() + interval '10 minutes'),
  created_at  timestamptz default now()
);
create index if not exists pending_actions_profile_idx on pending_actions(profile_id, created_at desc);
create index if not exists pending_actions_expiry_idx on pending_actions(expires_at);

-- ── Follow-up reminders (the 9am job reads this) ─────────────────────────────
create table if not exists reminder_schedule (
  id         uuid primary key default gen_random_uuid(),
  company_id bigint references "Companies"(id) on delete cascade,
  profile_id uuid references "Profiles"(id) on delete cascade,
  client_id  bigint references client_requests(id) on delete cascade,
  due_date   date not null default current_date,
  status     text not null default 'pending'
               check (status in ('pending', 'sent', 'done', 'snoozed', 'not_interested')),
  sent_at    timestamptz,
  created_at timestamptz default now()
);
create index if not exists reminder_due_idx on reminder_schedule(due_date, status);
create index if not exists reminder_profile_idx on reminder_schedule(profile_id, status);

-- ── RLS — same rule the rest of the app uses ─────────────────────────────────
alter table whatsapp_logs      enable row level security;
alter table conversation_state enable row level security;
alter table pending_actions    enable row level security;
alter table reminder_schedule  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['whatsapp_logs', 'conversation_state', 'pending_actions', 'reminder_schedule']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_full', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_full', t);
  end loop;
end $$;
