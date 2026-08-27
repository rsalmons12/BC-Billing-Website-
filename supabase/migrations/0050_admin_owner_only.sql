-- ============================================================================
-- Admin is owner-only. Managers (role = management, is_owner = false) run
-- collections but must not manage users, facilities, or assignments. The Admin
-- screen is hidden/redirected in the app; this locks the underlying writes at
-- the database level too, so a manager can't change them via the API.
--
-- IMPORTANT nuance: a manager CAN still set a collector's daily target from the
-- Queue screen (that writes profiles.daily_target). So instead of blanket-
-- locking every profile write to owners, we lock facilities + assignments
-- fully, and on profiles we block only the ADMIN-managed columns (role, owner,
-- invoices, daily-email opt-out, allowed tabs, job title, queue tier, facility)
-- for non-owners, while leaving daily_target writable. Run once in the Supabase
-- SQL editor.
-- ============================================================================

-- Helper: is the current user an owner?
create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from profiles where id = auth.uid()), false);
$$;

-- ---- facilities: owners write, management still reads ----
drop policy if exists fac_write on facilities;
create policy fac_write on facilities for all using (is_owner()) with check (is_owner());

-- ---- assignments: owners write, management still reads ----
drop policy if exists asg_write on assignments;
create policy asg_write on assignments for all using (is_owner()) with check (is_owner());

-- ---- profiles: block ADMIN-managed columns for non-owners ----
-- Supersedes the is_owner-only guard from 0049 with a broader one covering every
-- Admin-managed field. A request with no authenticated user (SQL editor /
-- service role) is always allowed, so seeding still works.
create or replace function guard_is_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not exists (select 1 from profiles p where p.id = auth.uid() and p.is_owner = true)
  then
    if new.role               is distinct from old.role
       or new.is_owner        is distinct from old.is_owner
       or new.receives_invoices is distinct from old.receives_invoices
       or new.receives_daily_emails is distinct from old.receives_daily_emails
       or new.allowed_tabs    is distinct from old.allowed_tabs
       or new.job_title       is distinct from old.job_title
       or new.queue_tier      is distinct from old.queue_tier
       or new.facility_id     is distinct from old.facility_id
    then
      raise exception 'Only an owner can change admin-managed profile fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_is_owner on profiles;
create trigger trg_guard_is_owner
  before update on profiles
  for each row execute function guard_is_owner();
