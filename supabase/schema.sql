-- ============================================================================
-- Recovery Desk — database schema + security model (Supabase / PostgreSQL)
-- ============================================================================
-- This is the foundation that makes multi-user logins safe:
--   * management  -> sees and edits everything
--   * staff       -> sees/edits ONLY the facilities assigned to them
--   * facility    -> sees ONLY its own facility (read-only)
-- The "facility can only see its own data" guarantee is enforced by Postgres
-- Row-Level Security (RLS), not by the app UI. Even a hand-crafted API call
-- cannot read another facility's rows.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- ============================================================================

-- ---------- roles ----------
do $$ begin
  create type user_role as enum ('management', 'staff', 'facility', 'pending');
exception when duplicate_object then null; end $$;

-- ---------- facilities ----------
create table if not exists facilities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  short_name  text,
  npi         text,
  ein         text,
  state       text default 'NJ',
  created_at  timestamptz not null default now()
);

-- ---------- profiles (one row per auth user) ----------
-- role + (for facility users) which single facility they belong to.
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  initials     text,
  role         user_role not null default 'pending',
  facility_id  uuid references facilities(id) on delete set null, -- set for role='facility'
  created_at   timestamptz not null default now()
);

-- ---------- staff -> facility assignments (many-to-many) ----------
create table if not exists assignments (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  facility_id uuid not null references facilities(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (profile_id, facility_id)
);

-- ---------- claims (the weekly imported facts; refreshed each import) ----------
create table if not exists claims (
  id            uuid primary key default gen_random_uuid(),
  claim_id      text not null,                 -- external claim # (stable, used to match)
  facility_id   uuid not null references facilities(id) on delete cascade,
  patient_name  text,
  member_id     text,
  dob           text,
  dos_from      text,
  dos_to        text,
  charge_amount numeric,
  balance       numeric,
  age_days      int,
  bucket        text,
  claim_status  text,
  week          text,
  present       boolean not null default true, -- false once a claim drops off the latest import
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (claim_id)
);
create index if not exists claims_facility_idx on claims(facility_id);
create index if not exists claims_age_idx on claims(age_days);

-- ---------- claim_work (the collector layer; PERSISTS across weekly imports) ----------
-- Notes never get wiped by re-import because imports only upsert `claims`,
-- never this table. This is the database version of the "note bank".
create table if not exists claim_work (
  claim_id           text primary key,         -- matches claims.claim_id
  notes              text default '',
  initials           text default '',
  date_worked        text default '',
  med_rec            text default '',
  auth_flag          text default '',
  billing            text default '',
  cap_blue           text default '',
  highmark           text default '',
  rebill             text default '',
  mgmt_needed        boolean default false,
  auth_issue_status  text default '',          -- '', 'open', 'completed'
  auth_notes         text default '',
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now()
);

-- ---------- auth_issues (routed from collectors to the auth team) ----------
create table if not exists auth_issues (
  id              uuid primary key default gen_random_uuid(),
  claim_id        text,                         -- source claim, if routed from collections
  facility_id     uuid references facilities(id) on delete cascade,
  patient_name    text,
  payer           text,
  dos_from        text,
  dos_to          text,
  charge_amount   numeric,
  status          text default 'Not Worked',    -- Not Worked / Working / Completed
  mgmt_needed     boolean default false,
  notes           text default '',
  from_collection boolean default false,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists auth_issues_facility_idx on auth_issues(facility_id);

-- ============================================================================
-- Security helper functions (SECURITY DEFINER so they can read profiles/
-- assignments without tripping RLS recursion).
-- ============================================================================
create or replace function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_management() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'management' from profiles where id = auth.uid()), false);
$$;

create or replace function can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('management','staff') from profiles where id = auth.uid()), false);
$$;

-- the set of facility ids the current user may access
create or replace function accessible_facility_ids() returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare r user_role;
begin
  select role into r from profiles where id = auth.uid();
  if r = 'management' then
    return query select id from facilities;
  elsif r = 'facility' then
    return query select facility_id from profiles where id = auth.uid() and facility_id is not null;
  elsif r = 'staff' then
    return query select facility_id from assignments where profile_id = auth.uid();
  else
    return; -- pending / unknown -> nothing
  end if;
end $$;

-- ============================================================================
-- Enable RLS + policies
-- ============================================================================
alter table facilities  enable row level security;
alter table profiles    enable row level security;
alter table assignments enable row level security;
alter table claims      enable row level security;
alter table claim_work  enable row level security;
alter table auth_issues enable row level security;

-- ---- facilities ----
drop policy if exists fac_select on facilities;
create policy fac_select on facilities for select using (
  is_management() or id in (select accessible_facility_ids())
);
drop policy if exists fac_write on facilities;
create policy fac_write on facilities for all using (is_management()) with check (is_management());

-- ---- profiles ----
drop policy if exists prof_self on profiles;
create policy prof_self on profiles for select using (id = auth.uid() or is_management());
drop policy if exists prof_self_update on profiles;
create policy prof_self_update on profiles for update using (id = auth.uid() or is_management());
drop policy if exists prof_mgmt_all on profiles;
create policy prof_mgmt_all on profiles for all using (is_management()) with check (is_management());

-- ---- assignments (management manages; staff can read their own) ----
drop policy if exists asg_read on assignments;
create policy asg_read on assignments for select using (is_management() or profile_id = auth.uid());
drop policy if exists asg_write on assignments;
create policy asg_write on assignments for all using (is_management()) with check (is_management());

-- ---- claims ----
drop policy if exists claims_select on claims;
create policy claims_select on claims for select using (
  is_management() or facility_id in (select accessible_facility_ids())
);
drop policy if exists claims_write on claims;
create policy claims_write on claims for all using (
  can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))
) with check (
  can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))
);
-- NOTE: facility role is read-only (can_edit() is false for them).

-- ---- claim_work (joined to claims by claim_id for facility scoping) ----
drop policy if exists work_select on claim_work;
create policy work_select on claim_work for select using (
  is_management() or exists (
    select 1 from claims c where c.claim_id = claim_work.claim_id
    and c.facility_id in (select accessible_facility_ids())
  )
);
drop policy if exists work_write on claim_work;
create policy work_write on claim_work for all using (
  can_edit() and exists (
    select 1 from claims c where c.claim_id = claim_work.claim_id
    and (is_management() or c.facility_id in (select accessible_facility_ids()))
  )
) with check (
  can_edit() and exists (
    select 1 from claims c where c.claim_id = claim_work.claim_id
    and (is_management() or c.facility_id in (select accessible_facility_ids()))
  )
);

-- ---- auth_issues ----
drop policy if exists ai_select on auth_issues;
create policy ai_select on auth_issues for select using (
  is_management() or facility_id in (select accessible_facility_ids())
);
drop policy if exists ai_write on auth_issues;
create policy ai_write on auth_issues for all using (
  can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))
) with check (
  can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))
);

-- ============================================================================
-- Auto-create a profile row whenever someone signs up (least privilege).
-- Management then sets their role + facility/assignments in the Admin screen.
-- ============================================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'pending')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- Done. After running this:
--   1. Create your own user, then in the SQL editor run:
--        update profiles set role='management' where id = (select id from auth.users where email='YOU@EMAIL');
--   2. Insert facilities (see seed.sql).
--   3. For a facility login (e.g. Daniel @ Shore Break): create the user, then
--        update profiles set role='facility',
--               facility_id=(select id from facilities where short_name='Shore Break')
--        where id=(select id from auth.users where email='daniel@...');
--   4. For a collector: set role='staff' and add rows to `assignments`.
-- ============================================================================
