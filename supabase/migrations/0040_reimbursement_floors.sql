-- ============================================================================
-- Global app settings (key/value). First use: reimbursement floors per level of
-- care, driving the daily recap's "patients below reimbursement floor" list.
--   key = 'reimbursement_floor', value = { "php": 1000, "iop": 800 }
-- Run once in the Supabase SQL editor.
-- ============================================================================
create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

alter table app_settings enable row level security;

-- Any signed-in user may read settings (facility recaps read the floors);
-- only management may change them.
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings for select using (auth.uid() is not null);
drop policy if exists app_settings_write on app_settings;
create policy app_settings_write on app_settings for all using (is_management()) with check (is_management());

grant select, insert, update, delete on app_settings to authenticated;
