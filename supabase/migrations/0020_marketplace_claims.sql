-- ============================================================================
-- Marketplace / Exchange plan claims. Collectors "shift" a claim here from the
-- Queue (marketplace/exchange plans carry a high non-reimbursement risk), where
-- management reviews them separately. Mirrors claim_adjustments.
-- ============================================================================
create table if not exists marketplace_claims (
  id uuid primary key default gen_random_uuid(),
  claim_id text, facility_id uuid references facilities(id) on delete set null,
  patient_name text, member_id text, dob text, dos_from text, dos_to text,
  charge_amount numeric, balance numeric, age_days int, claim_status text,
  payer text, reason text default '', initials text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists marketplace_claims_facility_idx on marketplace_claims(facility_id);
create unique index if not exists marketplace_claims_claim_id_key on marketplace_claims(claim_id);
alter table marketplace_claims enable row level security;
drop policy if exists mkt_select on marketplace_claims;
create policy mkt_select on marketplace_claims for select
  using (is_management() or facility_id in (select accessible_facility_ids()));
drop policy if exists mkt_insert on marketplace_claims;
create policy mkt_insert on marketplace_claims for insert
  with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));
drop policy if exists mkt_update on marketplace_claims;
create policy mkt_update on marketplace_claims for update
  using (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));
drop policy if exists mkt_delete on marketplace_claims;
create policy mkt_delete on marketplace_claims for delete using (is_management());
grant select, insert, update, delete on marketplace_claims to authenticated;
