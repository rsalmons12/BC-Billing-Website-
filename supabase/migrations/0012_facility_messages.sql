-- ============================================================================
-- Facility messaging: email a facility from the app and keep a thread per
-- facility (and optionally per claim). Run once in the Supabase SQL editor.
-- ============================================================================

-- Where to email each facility.
alter table facilities add column if not exists email text;

create table if not exists facility_messages (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid references facilities(id) on delete cascade,
  claim_id     text,                       -- optional: the claim this is about
  patient_name text,
  subject      text default '',
  body         text default '',
  direction    text default 'outbound',    -- 'outbound' (we emailed) | 'inbound' (reply)
  from_email   text default '',
  to_email     text default '',
  sender_id    uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists facility_messages_facility_idx on facility_messages(facility_id);
create index if not exists facility_messages_claim_idx    on facility_messages(claim_id);
create index if not exists facility_messages_created_idx   on facility_messages(created_at);

alter table facility_messages enable row level security;

-- Management + staff see/insert for facilities they can access; a facility
-- login sees its own thread.
drop policy if exists fmsg_select on facility_messages;
create policy fmsg_select on facility_messages for select
  using (is_management() or facility_id in (select accessible_facility_ids()));

drop policy if exists fmsg_insert on facility_messages;
create policy fmsg_insert on facility_messages for insert
  with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())));

-- authenticated for the app; service_role for the inbound webhook (writes
-- replies via the service-role client, bypassing a user session).
grant select, insert, update, delete on facility_messages to authenticated, service_role;
