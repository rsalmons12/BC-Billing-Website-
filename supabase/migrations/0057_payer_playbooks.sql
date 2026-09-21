-- ============================================================================
-- Payer playbooks — per-payer "how to handle these claims" directions shown as
-- a pop-up when a payer is opened on the Repricing tab. Keyed by payer family
-- (e.g. "Aetna", "BCBS", "Cigna"). Everyone signed in can READ; only management
-- can WRITE. Run once in the Supabase SQL editor (safe to re-run).
-- ============================================================================
create table if not exists payer_playbooks (
  payer        text primary key,
  instructions text not null default '',
  -- Example files (AOR form, spreadsheet template) stored in the private
  -- "attachments" bucket: [{ "name", "path", "size", "type" }, ...].
  attachments  jsonb not null default '[]'::jsonb,
  updated_by   uuid references profiles(id),
  updated_at   timestamptz not null default now()
);
alter table payer_playbooks add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table payer_playbooks enable row level security;

grant select, insert, update, delete on payer_playbooks to authenticated, service_role;

-- Any signed-in user may read the directions.
drop policy if exists pp_select on payer_playbooks;
create policy pp_select on payer_playbooks for select using (auth.uid() is not null);

-- Only management writes them.
drop policy if exists pp_write on payer_playbooks;
create policy pp_write on payer_playbooks for all
  using (is_management()) with check (is_management());
