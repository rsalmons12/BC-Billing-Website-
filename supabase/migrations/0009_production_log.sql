-- ============================================================================
-- Production log: append-only record of every "claim worked" event, so
-- management can report on daily staff production over time. (claim_work's
-- date_worked is overwritten each time a claim is touched, so it can't give a
-- day-by-day history on its own.)
-- Run once in the Supabase SQL editor (safe to re-run).
-- ============================================================================
create table if not exists production_log (
  id          uuid primary key default gen_random_uuid(),
  collector_id uuid references auth.users(id) on delete cascade,
  claim_id     text,
  facility_id  uuid references facilities(id) on delete set null,
  worked_on    date not null default current_date,
  created_at   timestamptz not null default now()
);

create index if not exists production_log_worked_on_idx  on production_log(worked_on);
create index if not exists production_log_collector_idx  on production_log(collector_id);
create index if not exists production_log_facility_idx   on production_log(facility_id);
-- One production credit per collector per claim per day (idempotent re-clicks).
create unique index if not exists production_log_unique
  on production_log(collector_id, claim_id, worked_on);

alter table production_log enable row level security;

-- Management sees everything; a collector may see/insert/delete their own rows.
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
