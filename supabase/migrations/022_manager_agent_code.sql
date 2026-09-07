-- Managers/owners work deals too, so they need an agent_code to OWN listings and
-- clients (ownership, "Mine", matching credit and referral commission all key off
-- the code). New managers get a code at signup; this backfills every owner/manager
-- profile created before that which is still missing one.
--
-- 'MGR-<n>' is unique per company and can't clash with an agent code (those are
-- two-letter initials + 3 digits, e.g. "JD-421"), so this is collision-safe.

update "Profiles" p
set agent_code = 'MGR-' || sub.rn
from (
  select id,
         row_number() over (partition by company_id order by id) as rn
  from "Profiles"
  where role in ('owner', 'manager')
    and (agent_code is null or agent_code = '')
) sub
where p.id = sub.id;
