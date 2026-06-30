-- ============================================================================
-- CONSOLIDATED migration — safe to run any time (idempotent).
-- Paste the whole thing into Supabase -> SQL Editor -> New query -> Run.
-- Creates/updates every table the app's tabs need.
-- ============================================================================

-- ---- Trackers: authorizations, negotiations, medical_records ----
create table if not exists authorizations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  patient_name text, admit_date text, start_date text, end_date text,
  discharge_date text, next_review_date text, auth_number text,
  level_of_care text, status text default 'Pending', notes text default '',
  discharged boolean not null default false,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists authorizations_facility_idx on authorizations(facility_id);
alter table authorizations add column if not exists discharged boolean not null default false;

create table if not exists negotiations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  patient_name text, dos text, vendor text, carrier text,
  charged_amount numeric, proposed_amount numeric, negotiated_amount numeric,
  status text default '', date_signed text, extra_paid numeric,
  proposed_rate numeric, approved_rate numeric, other_vendor text,
  negotiator text, work_date text, notes text default '',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists negotiations_facility_idx on negotiations(facility_id);

create table if not exists medical_records (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  patient_name text, dos_from text, dos_to text, charge_amount numeric,
  payer text, record_status text default '', claim_status text,
  date_received text, dcn text, pages text, paid_amount numeric,
  notes text default '', updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists medical_records_facility_idx on medical_records(facility_id);

-- ---- Payments + Repricing ----
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  payment_entered text, deposit_date text, patient_name text, member_id text,
  cpt_description text, payment_source text, dos_from text, dos_to text,
  charge_amount numeric, paid_amount numeric, payment_type text, check_number text,
  notes text default '', updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists payments_facility_idx on payments(facility_id);

create table if not exists repricing (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  claim_id text, patient_name text, member_id text, claim_from text,
  total_amount numeric, amount_paid numeric, additional_payment numeric,
  payer text, remark_codes text, claim_status text,
  notes text default '', updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists repricing_facility_idx on repricing(facility_id);
alter table repricing add column if not exists charge_amount numeric;
alter table repricing add column if not exists claim_date text;
alter table repricing add column if not exists amt_allowed numeric;
alter table repricing add column if not exists additional_payment numeric;
alter table repricing add column if not exists payment_status text default '';
alter table repricing add column if not exists follow_up text default '';
alter table repricing add column if not exists note_action text default '';
create unique index if not exists repricing_claim_id_key on repricing(claim_id);

-- ---- Historical Data (global reference) ----
create table if not exists historical_data (
  id uuid primary key default gen_random_uuid(),
  state text, year text, prefix text, prefix_length text, payer text,
  code_type text, code_used text, cpt_code text, rev_code text, description text,
  billed_per_day numeric, paid_per_day numeric,
  created_at timestamptz not null default now()
);
create index if not exists historical_prefix_idx on historical_data(prefix);
create index if not exists historical_payer_idx on historical_data(payer);

-- ---- Weekly Assignments ----
create table if not exists weekly_assignments (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  week text, collectors text default '', billers text default '',
  ur_specialist text default '', repricing_specialist text default '',
  pricing_specialist text default '', notes text default '',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists weekly_assignments_facility_idx on weekly_assignments(facility_id);

-- ---- Per-user tab access ----
alter table profiles add column if not exists allowed_tabs text[];

-- ---- Collection Queue: per-collector daily target + job title ----
alter table profiles add column if not exists daily_target int default 100;
alter table profiles add column if not exists job_title text default 'Collector';

-- ---- Resolve / close out claims (counted in Reporting) ----
alter table claim_work add column if not exists resolved   boolean default false;
alter table claim_work add column if not exists resolved_at timestamptz;
alter table claim_work add column if not exists resolved_by uuid references auth.users(id);
create index if not exists claim_work_resolved_at_idx on claim_work(resolved_at);

-- ---- RLS (facility-scoped) for the facility-scoped tables ----
alter table authorizations    enable row level security;
alter table negotiations      enable row level security;
alter table medical_records   enable row level security;
alter table payments          enable row level security;
alter table repricing         enable row level security;
alter table weekly_assignments enable row level security;
do $$
declare t text;
begin
  foreach t in array array['authorizations','negotiations','medical_records','payments','repricing','weekly_assignments']
  loop
    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (is_management() or facility_id in (select accessible_facility_ids()))', t);
    -- Split write policy: staff may insert/update accessible facilities;
    -- DELETE is management only (prevents non-mgmt from wiping rows, incl. via
    -- the destructive replace-import).
    execute format('drop policy if exists %1$s_write  on %1$s', t);
    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('drop policy if exists %1$s_delete on %1$s', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))', t);
    execute format('create policy %1$s_update on %1$s for update using (can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))) with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))', t);
    execute format('create policy %1$s_delete on %1$s for delete using (is_management())', t);
  end loop;
end $$;

-- ---- Historical Data RLS (read for any signed-in user, write management) ----
alter table historical_data enable row level security;
drop policy if exists hist_select on historical_data;
create policy hist_select on historical_data for select using (auth.uid() is not null);
drop policy if exists hist_write on historical_data;
create policy hist_write on historical_data for all using (is_management()) with check (is_management());

-- ---- Facility messaging (email a facility + thread) ----
alter table facilities add column if not exists email text;
create table if not exists facility_messages (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references facilities(id) on delete cascade,
  claim_id text, patient_name text,
  subject text default '', body text default '',
  direction text default 'outbound', from_email text default '', to_email text default '',
  sender_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists facility_messages_facility_idx on facility_messages(facility_id);
create index if not exists facility_messages_claim_idx on facility_messages(claim_id);
alter table facility_messages enable row level security;
drop policy if exists fmsg_select on facility_messages;
create policy fmsg_select on facility_messages for select
  using (is_management() or facility_id in (select accessible_facility_ids()));
drop policy if exists fmsg_insert on facility_messages;
create policy fmsg_insert on facility_messages for insert
  with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));
grant select, insert, update, delete on facility_messages to authenticated;

-- ---- Production log: append-only staff-production events for reporting ----
create table if not exists production_log (
  id          uuid primary key default gen_random_uuid(),
  collector_id uuid references auth.users(id) on delete cascade,
  claim_id     text,
  facility_id  uuid references facilities(id) on delete set null,
  worked_on    date not null default current_date,
  created_at   timestamptz not null default now()
);
create index if not exists production_log_worked_on_idx on production_log(worked_on);
create index if not exists production_log_collector_idx on production_log(collector_id);
create index if not exists production_log_facility_idx  on production_log(facility_id);
create unique index if not exists production_log_unique
  on production_log(collector_id, claim_id, worked_on);
alter table production_log enable row level security;
drop policy if exists production_log_select on production_log;
create policy production_log_select on production_log for select
  using (is_management() or collector_id = auth.uid());
drop policy if exists production_log_insert on production_log;
create policy production_log_insert on production_log for insert
  with check (collector_id = auth.uid() or is_management());
drop policy if exists production_log_delete on production_log;
create policy production_log_delete on production_log for delete
  using (collector_id = auth.uid() or is_management());
grant select, insert, update, delete on production_log to authenticated;

-- ---- Grants (RLS still governs rows) ----
grant select, insert, update, delete on
  authorizations, negotiations, medical_records, payments, repricing,
  weekly_assignments, historical_data
  to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
