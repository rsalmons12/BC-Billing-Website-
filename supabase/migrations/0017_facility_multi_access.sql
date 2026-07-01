-- ============================================================================
-- Multi-facility facility logins. A facility user can now be granted access to
-- more than one facility: their profile.facility_id (primary) plus any rows in
-- the assignments table (the same table staff use). Re-run is safe.
-- ============================================================================
create or replace function accessible_facility_ids() returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare r user_role;
begin
  select role into r from profiles where id = auth.uid();
  if r = 'management' then
    return query select id from facilities;
  elsif r = 'facility' then
    return query
      select facility_id from profiles
        where id = auth.uid() and facility_id is not null
      union
      select facility_id from assignments where profile_id = auth.uid();
  elsif r = 'staff' then
    return query select facility_id from assignments where profile_id = auth.uid();
  else
    return; -- pending / unknown -> nothing
  end if;
end $$;
