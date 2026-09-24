-- Places an agency has taught the app.
--
-- The built-in gazetteer holds 3,602 Lebanese places and the country has more.
-- When an agent types somewhere it does not know, they drop a pin on it once
-- and it joins their agency's gazetteer: suggested as they type, corrected to a
-- single spelling, and used by matching like any other area.
--
-- Scoped to the agency on purpose. One agency's pin is not evidence enough to
-- move another agency's matching, and a name means different things in
-- different parts of the country. Good ones can be promoted into the built-in
-- data later, where every agency gets them.
--
-- Safe to run more than once.

create table if not exists company_areas (
  id           bigserial primary key,
  company_id   bigint not null references "Companies"(id) on delete cascade,
  name         text   not null,
  lat          double precision not null,
  lng          double precision not null,
  -- Read off the nearest known place when the pin is dropped, so a client who
  -- asks for a whole caza still matches a listing filed here.
  caza         text,
  governorate  text,
  -- Who taught it, as an agent_code, so a wrong pin can be traced.
  created_by   text,
  created_at   timestamptz not null default now()
);

-- The read is always "this agency's areas", on every listing form.
create index if not exists company_areas_company on company_areas (company_id);

-- One pin per name per agency. Case- and space-insensitive, so "Hbous",
-- "hbous" and " Hbous " cannot become three areas — which is the exact problem
-- this table exists to end.
create unique index if not exists company_areas_name_uniq
  on company_areas (company_id, lower(regexp_replace(name, '\s+', ' ', 'g')));

alter table company_areas enable row level security;

-- Same rule as the rest of the app (see 006/007/008): the API checks the
-- company, the policy keeps it to signed-in users.
drop policy if exists company_areas_authenticated_full on public.company_areas;
create policy company_areas_authenticated_full
  on public.company_areas for all to authenticated
  using (true) with check (true);
