-- ============================================================================
-- Payment + Repricing tabs. Run once in the Supabase SQL editor.
-- ============================================================================

create table if not exists payments (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid references facilities(id) on delete cascade,
  payment_entered text,
  deposit_date    text,
  patient_name    text,
  member_id       text,
  cpt_description text,
  payment_source  text,
  dos_from        text,
  dos_to          text,
  charge_amount   numeric,
  paid_amount     numeric,
  payment_type    text,
  check_number    text,
  notes           text default '',
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists payments_facility_idx on payments(facility_id);

create table if not exists repricing (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid references facilities(id) on delete cascade,
  claim_id        text,
  patient_name    text,
  member_id       text,
  claim_from      text,
  total_amount    numeric,
  amount_paid     numeric,
  additional_paid numeric,
  payer           text,
  remark_codes    text,
  claim_status    text,
  notes           text default '',
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists repricing_facility_idx on repricing(facility_id);

alter table payments  enable row level security;
alter table repricing enable row level security;

do $$
declare t text;
begin
  foreach t in array array['payments','repricing']
  loop
    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (is_management() or facility_id in (select accessible_facility_ids()))', t);
    execute format('drop policy if exists %1$s_write on %1$s', t);
    execute format('create policy %1$s_write on %1$s for all using (can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))) with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))', t);
  end loop;
end $$;

grant select, insert, update, delete on payments, repricing to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
