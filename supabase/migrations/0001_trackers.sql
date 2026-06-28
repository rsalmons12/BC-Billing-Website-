-- ============================================================================
-- Trackers: Authorization, Negotiations, Medical Records
-- Run once in the Supabase SQL editor (after schema.sql).
-- Each table is facility-scoped and protected by the same RLS model as claims.
-- ============================================================================

-- ---------- authorizations ----------
create table if not exists authorizations (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid references facilities(id) on delete cascade,
  patient_name     text,
  admit_date       text,
  start_date       text,
  end_date         text,
  discharge_date   text,
  next_review_date text,
  auth_number      text,
  level_of_care    text,
  status           text default 'Pending',   -- Approval / Pending / Denied / Peer to Peer
  notes            text default '',
  updated_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists authorizations_facility_idx on authorizations(facility_id);

-- ---------- negotiations ----------
create table if not exists negotiations (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid references facilities(id) on delete cascade,
  patient_name      text,
  dos               text,
  vendor            text,
  carrier           text,
  charged_amount    numeric,
  proposed_amount   numeric,
  negotiated_amount numeric,
  status            text default '',          -- Approved / Rejected / Pending ...
  date_signed       text,
  extra_paid        numeric,
  proposed_rate     numeric,
  approved_rate     numeric,
  other_vendor      text,
  negotiator        text,
  work_date         text,
  notes             text default '',
  updated_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists negotiations_facility_idx on negotiations(facility_id);

-- ---------- medical_records ----------
create table if not exists medical_records (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid references facilities(id) on delete cascade,
  patient_name   text,
  dos_from       text,
  dos_to         text,
  charge_amount  numeric,
  payer          text,
  record_status  text default '',             -- Received / Faxed / Mailed / Appeal / Denied / Approved
  claim_status   text,
  date_received  text,
  dcn            text,
  pages          text,
  paid_amount    numeric,
  notes          text default '',
  updated_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists medical_records_facility_idx on medical_records(facility_id);

-- ============================================================================
-- RLS — same pattern as claims (facility-scoped read, staff/management write).
-- ============================================================================
alter table authorizations enable row level security;
alter table negotiations   enable row level security;
alter table medical_records enable row level security;

do $$
declare t text;
begin
  foreach t in array array['authorizations','negotiations','medical_records']
  loop
    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format(
      'create policy %1$s_select on %1$s for select using (is_management() or facility_id in (select accessible_facility_ids()))',
      t);
    execute format('drop policy if exists %1$s_write on %1$s', t);
    execute format(
      'create policy %1$s_write on %1$s for all using (can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))) with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))',
      t);
  end loop;
end $$;

-- ============================================================================
-- Grants — let the API roles reach the new tables (RLS still governs rows).
-- ============================================================================
grant select, insert, update, delete on authorizations, negotiations, medical_records
  to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Done.
