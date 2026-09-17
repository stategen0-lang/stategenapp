-- ─────────────────────────────────────────────────────────────────────────────
-- Login rate limiting
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks failed sign-in attempts per identifier (the email or Agent ID typed
-- on the login form) so repeated wrong-password guessing gets locked out and
-- flagged — instead of being retried forever against Supabase Auth.
--
-- RLS is enabled with NO policies: this table is only ever touched by
-- /api/auth/login-guard using the service-role admin client (the login form
-- runs before any session exists, so there is no authenticated user to scope
-- a policy to). That makes it unreachable via the anon/authenticated keys,
-- which is exactly what a pre-auth table needs.
-- Safe to run more than once.

create table if not exists login_attempts (
  identifier    text primary key,       -- normalized (trimmed, lowercased) email/Agent ID
  fail_count    int not null default 0,
  window_start  timestamptz not null default now(),
  locked_until  timestamptz,
  notified_at   timestamptz
);

alter table login_attempts enable row level security;
-- Deliberately no policies — service role only (see note above).

-- A lockout is short-lived; keep the table from growing forever.
create index if not exists login_attempts_window_idx on login_attempts(window_start);
