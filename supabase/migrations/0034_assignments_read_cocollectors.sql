-- ============================================================================
-- Even dispersal needs each collector to see WHO ELSE works their facilities,
-- so the queue can split a facility's claims evenly across its roster. Previously
-- a staff member could read only their OWN assignment row, so a staff roster was
-- just themselves and no even split was possible (the queue fell back to a shared
-- first-come pool). Widen asg_read so a collector can also read the assignment
-- rows for any facility they can access. Management still sees all. Re-run safe.
-- ============================================================================
drop policy if exists asg_read on assignments;
create policy asg_read on assignments for select using (
  is_management()
  or profile_id = auth.uid()
  or facility_id in (select accessible_facility_ids())
);
