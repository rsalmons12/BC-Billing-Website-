-- ============================================================================
-- Ensure the facilities table itself is row-scoped. Without this a facility
-- login could read every facility row (names, etc.). Safe to re-run.
-- ============================================================================
alter table facilities enable row level security;
drop policy if exists fac_select on facilities;
create policy fac_select on facilities for select
  using (is_management() or id in (select accessible_facility_ids()));
drop policy if exists fac_write on facilities;
create policy fac_write on facilities for all
  using (is_management()) with check (is_management());
