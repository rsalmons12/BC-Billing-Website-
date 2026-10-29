-- ============================================================================
-- HR & Compliance portal (served at hr.bcbilling.cloud).
--
-- Adds an `hr` role and three tables: facility state licenses, staff/HR records,
-- and compliance documents. An `hr` login with a facility_id is scoped to that
-- facility; an `hr` login with NO facility_id (and management) sees everything.
--
-- Run in the Supabase SQL editor. IMPORTANT: a new enum value must be committed
-- before it can be used, so run STEP 1 BY ITSELF first, let it finish, THEN run
-- STEP 2. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — run this single line on its own first:
-- ---------------------------------------------------------------------------
alter type user_role add value if not exists 'hr';


-- ---------------------------------------------------------------------------
-- STEP 2 — run everything below AFTER step 1 has succeeded:
-- ---------------------------------------------------------------------------

-- Any hr login.
create or replace function is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'hr' from profiles where id = auth.uid()), false);
$$;

-- An ORG-WIDE hr login (internal HR/compliance team): role = hr with no facility.
-- These see every facility's HR/compliance data. A facility-scoped hr login (one
-- with a facility_id) only sees its own facility, via accessible_facility_ids().
create or replace function is_hr_all() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'hr' and facility_id is null from profiles where id = auth.uid()),
    false
  );
$$;

-- HR logins must read the facilities list (names, pickers). Recreate the select
-- policy to also allow hr: ORG-WIDE hr sees every facility; a facility-scoped hr
-- only sees its own (via accessible_facility_ids). Keeps management + repricer +
-- facility access intact.
drop policy if exists fac_select on facilities;
create policy fac_select on facilities for select
  using (
    is_management()
    or is_repricer()
    or is_hr_all()
    or id in (select accessible_facility_ids())
  );

-- Shared visibility predicate for the HR tables: management and org-wide hr see
-- all; a facility-scoped hr sees only its own facility's rows.
-- (expressed inline in each policy below)

-- ---- Facility state licenses --------------------------------------------
create table if not exists facility_licenses (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references facilities(id) on delete cascade,
  licensing_body text,                    -- the state body that issues the license
  license_state  text,                    -- 2-letter state the license is issued in
  license_type   text,                    -- e.g. "Behavioral Health", "SUD/DMHAS"
  license_number text,
  issued_date    date,
  expires_date   date,
  status         text not null default 'active', -- active / pending / expired / revoked
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists facility_licenses_facility_idx on facility_licenses(facility_id);
create index if not exists facility_licenses_expires_idx on facility_licenses(expires_date);

alter table facility_licenses enable row level security;
drop policy if exists hr_lic_all on facility_licenses;
create policy hr_lic_all on facility_licenses for all
  using (
    is_management() or is_hr_all()
    or (is_hr() and facility_id in (select accessible_facility_ids()))
  )
  with check (
    is_management() or is_hr_all()
    or (is_hr() and facility_id in (select accessible_facility_ids()))
  );
grant select, insert, update, delete on facility_licenses to anon, authenticated;

-- ---- Staff / HR records --------------------------------------------------
create table if not exists staff_members (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid references facilities(id) on delete set null, -- null = org-wide
  full_name         text not null,
  title             text,                  -- job title / position
  email             text,
  phone             text,
  hire_date         date,
  status            text not null default 'active', -- active / inactive / terminated
  credential_type   text,                  -- e.g. "RN", "LCSW", "CADC"
  credential_number text,
  credential_state  text,
  credential_expires date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists staff_members_facility_idx on staff_members(facility_id);
create index if not exists staff_members_cred_exp_idx on staff_members(credential_expires);

alter table staff_members enable row level security;
drop policy if exists hr_staff_all on staff_members;
create policy hr_staff_all on staff_members for all
  using (
    is_management() or is_hr_all()
    or (is_hr() and facility_id in (select accessible_facility_ids()))
  )
  with check (
    is_management() or is_hr_all()
    or (is_hr() and facility_id in (select accessible_facility_ids()))
  );
grant select, insert, update, delete on staff_members to anon, authenticated;

-- ---- Compliance documents ------------------------------------------------
-- Files live in the existing `attachments` storage bucket under compliance/…;
-- this table is the metadata + tracking layer.
create table if not exists compliance_documents (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid references facilities(id) on delete cascade,
  category     text not null default 'policy', -- policy / audit / incident / license / training / other
  title        text not null,
  path         text,                   -- object path in the attachments bucket
  content_type text,
  size_bytes   bigint,
  doc_date     date,
  expires_date date,
  notes        text,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists compliance_documents_facility_idx on compliance_documents(facility_id);

alter table compliance_documents enable row level security;
drop policy if exists hr_doc_all on compliance_documents;
create policy hr_doc_all on compliance_documents for all
  using (
    is_management() or is_hr_all()
    or (is_hr() and facility_id in (select accessible_facility_ids()))
  )
  with check (
    is_management() or is_hr_all()
    or (is_hr() and facility_id in (select accessible_facility_ids()))
  );
grant select, insert, update, delete on compliance_documents to anon, authenticated;
