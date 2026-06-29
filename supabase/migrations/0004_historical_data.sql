-- ============================================================================
-- Historical Data: BCBS prefix reference (global lookup, not facility-scoped).
-- Run once in the Supabase SQL editor.
-- ============================================================================
create table if not exists historical_data (
  id             uuid primary key default gen_random_uuid(),
  state          text,
  year           text,
  prefix         text,
  prefix_length  text,
  payer          text,
  code_type      text,
  code_used      text,
  cpt_code       text,
  rev_code       text,
  description    text,
  billed_per_day numeric,
  paid_per_day   numeric,
  created_at     timestamptz not null default now()
);
create index if not exists historical_prefix_idx on historical_data(prefix);
create index if not exists historical_payer_idx on historical_data(payer);

alter table historical_data enable row level security;

-- Reference data: any signed-in user may read; only management may change it.
drop policy if exists hist_select on historical_data;
create policy hist_select on historical_data for select using (auth.uid() is not null);
drop policy if exists hist_write on historical_data;
create policy hist_write on historical_data for all using (is_management()) with check (is_management());

grant select, insert, update, delete on historical_data to anon, authenticated;
