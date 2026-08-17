-- ============================================================================
-- Collector roster (server-side, RLS-independent).
--
-- The collector Queue splits each facility's patients evenly across that
-- facility's collectors using a stable hash. For the split to be identical on
-- every collector's screen (so two people never work the same patient), each
-- collector must see the SAME roster of co-collectors. Row-Level Security on
-- `assignments` normally hides other collectors' rows, which collapsed each
-- roster to just the logged-in person → everyone "owned" every patient →
-- duplicate work and an uneven split.
--
-- This SECURITY DEFINER function returns the full facility→collector map,
-- bypassing that per-row visibility, and limits it to ACTUAL collectors
-- (role = staff whose job title is Collector, the only ones the queue drives),
-- so facility logins / billers / management don't get handed a share they never
-- work. Every collector calls it and gets the same answer.
--
-- Run once in the Supabase SQL editor.
-- ============================================================================
create or replace function collector_roster()
returns table(facility_id uuid, profile_id uuid)
language sql
security definer
set search_path = public
as $$
  select a.facility_id, a.profile_id
  from assignments a
  join profiles p on p.id = a.profile_id
  where p.role = 'staff'
    and coalesce(p.job_title, 'Collector') = 'Collector';
$$;

grant execute on function collector_roster() to authenticated;
