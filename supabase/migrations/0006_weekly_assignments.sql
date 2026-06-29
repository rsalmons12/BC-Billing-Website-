-- ============================================================================
-- Weekly Assignments: who works each facility, by role. Run once in Supabase.
-- ============================================================================
create table if not exists weekly_assignments (
  id                   uuid primary key default gen_random_uuid(),
  facility_id          uuid references facilities(id) on delete cascade,
  week                 text,
  collectors           text default '',
  billers              text default '',
  ur_specialist        text default '',
  repricing_specialist text default '',
  pricing_specialist   text default '',
  notes                text default '',
  updated_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists weekly_assignments_facility_idx on weekly_assignments(facility_id);

alter table weekly_assignments enable row level security;
drop policy if exists wa_select on weekly_assignments;
create policy wa_select on weekly_assignments for select using (is_management() or facility_id in (select accessible_facility_ids()));
drop policy if exists wa_write on weekly_assignments;
create policy wa_write on weekly_assignments for all using (can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))) with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));

grant select, insert, update, delete on weekly_assignments to anon, authenticated;
