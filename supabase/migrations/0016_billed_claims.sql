-- ============================================================================
-- Billed claims (CollaborateMD "Claims Billed Report"). Carries the payer name
-- per claim, so it powers AR-by-payer and Billed-this-month on the dashboard.
-- Keyed by claim_id (upsert refreshes amounts/balance on each import).
-- ============================================================================
create table if not exists billed_claims (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  claim_id text,
  times_billed int,
  from_date text, to_date text, entered_date text,
  total_amount numeric, balance numeric,
  patient_id text, patient_name text,
  payer_name text, payer_type text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billed_claims_facility_idx on billed_claims(facility_id);
create index if not exists billed_claims_payer_idx on billed_claims(payer_name);
create unique index if not exists billed_claims_claim_id_key on billed_claims(claim_id);

alter table billed_claims enable row level security;
drop policy if exists billed_select on billed_claims;
create policy billed_select on billed_claims for select
  using (is_management() or facility_id in (select accessible_facility_ids()));
drop policy if exists billed_insert on billed_claims;
create policy billed_insert on billed_claims for insert
  with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));
drop policy if exists billed_update on billed_claims;
create policy billed_update on billed_claims for update
  using (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))
  with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));
drop policy if exists billed_delete on billed_claims;
create policy billed_delete on billed_claims for delete using (is_management());
grant select, insert, update, delete on billed_claims to authenticated;
