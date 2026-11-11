-- An agent's own email, and whether they want a copy of every listing that goes
-- to the marketing team.
--
-- Separate from the login: an agent signs in with their agent ID, and the auth
-- email behind it is often made up from the code and the agency's domain
-- (see stategen-agent-login-email), not an inbox anyone reads.
--
-- Safe to run more than once.

alter table "Profiles" add column if not exists copy_email text;
alter table "Profiles" add column if not exists marketing_copy boolean not null default false;
