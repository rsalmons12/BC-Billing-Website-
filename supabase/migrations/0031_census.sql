-- ============================================================================
-- Weekly Census — facilities submit each week's per-patient daily service grid
-- (GN/CM/PF/PE/ID …) so billers can bill from it. One row = one patient for one
-- week; the 7 days live in `days` as { "YYYY-MM-DD": "code" }. Run once in the
-- Supabase SQL editor.
-- ============================================================================
create table if not exists census (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid references facilities(id) on delete cascade,
  week_start     date,
  week_label     text,
  level_of_care  text,
  patient_name   text,
  admit_date     text,
  insurance      text,
  member_id      text,
  auth           text,
  comments       text,
  step_up        text,
  repriced       text,
  days           jsonb default '{}'::jsonb,     -- { "YYYY-MM-DD": "GN/CM" }
  billing_status text default '',
  notes          text default '',
  updated_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists census_facility_idx on census(facility_id);
create index if not exists census_week_idx on census(week_start);

alter table census enable row level security;

drop policy if exists census_select on census;
create policy census_select on census for select
  using (is_management() or facility_id in (select accessible_facility_ids()));
-- Facilities submit their OWN census, so this intentionally does NOT require
-- can_edit() — any user may write census for facilities they can access.
drop policy if exists census_write on census;
create policy census_write on census for all
  using (is_management() or facility_id in (select accessible_facility_ids()))
  with check (is_management() or facility_id in (select accessible_facility_ids()));

grant select, insert, update, delete on census to anon, authenticated;
