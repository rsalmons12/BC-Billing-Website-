-- ============================================================================
-- Claim adjustments: collectors flag a claim from the Queue as "needs
-- adjustment"; it lands in the Adjustments tab with a snapshot of the claim.
-- Run once in the Supabase SQL editor (safe to re-run).
-- ============================================================================
create table if not exists claim_adjustments (
  id            uuid primary key default gen_random_uuid(),
  claim_id      text,
  facility_id   uuid references facilities(id) on delete set null,
  patient_name  text,
  member_id     text,
  dob           text,
  dos_from      text,
  dos_to        text,
  charge_amount numeric,
  balance       numeric,
  age_days      int,
  claim_status  text,
  reason        text default '',
  initials      text default '',
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists claim_adjustments_facility_idx on claim_adjustments(facility_id);
create index if not exists claim_adjustments_created_idx  on claim_adjustments(created_at);

alter table claim_adjustments enable row level security;

drop policy if exists adj_select on claim_adjustments;
create policy adj_select on claim_adjustments for select
  using (is_management() or facility_id in (select accessible_facility_ids()));

drop policy if exists adj_insert on claim_adjustments;
create policy adj_insert on claim_adjustments for insert
  with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));

drop policy if exists adj_update on claim_adjustments;
create policy adj_update on claim_adjustments for update
  using (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));

drop policy if exists adj_delete on claim_adjustments;
create policy adj_delete on claim_adjustments for delete using (is_management());

grant select, insert, update, delete on claim_adjustments to authenticated, service_role;
