-- ============================================================================
-- Lock down the owner flag at the database level. Row-level security lets a
-- management (or any) user update their OWN profile row, which would let a
-- manager set is_owner = true on themselves via the API and unlock invoices.
-- This trigger blocks ANY change to is_owner unless the caller is ALREADY an
-- owner. Requests with no authenticated user (the Supabase SQL editor / the
-- service role, where auth.uid() is null) are allowed — that is how you seed
-- the first owner below. Run once in the Supabase SQL editor.
-- ============================================================================

create or replace function guard_is_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_owner is distinct from old.is_owner then
    -- Allow the change only from the SQL editor / service role (no auth.uid())
    -- or from a user who is themselves already an owner.
    if auth.uid() is not null
       and not exists (
         select 1 from profiles p where p.id = auth.uid() and p.is_owner = true
       ) then
      raise exception 'Only an owner can change the owner flag';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_is_owner on profiles;
create trigger trg_guard_is_owner
  before update on profiles
  for each row execute function guard_is_owner();

-- Seed the first owner (runs as the service role here, so the trigger allows
-- it). After this, the ONLY way to become an owner is for an existing owner to
-- grant it in Admin → Users — nobody can flip themselves.
update profiles set is_owner = true
where id in (
  select id from auth.users where lower(email) = 'robertsalmons1@gmail.com'
);
