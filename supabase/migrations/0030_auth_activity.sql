-- ============================================================================
-- Per-action activity log for authorization + auth-issue work, so daily
-- production credits every edit on the day it happened (not just the last
-- touch). Written client-side on each save. Run once in the Supabase SQL editor.
-- ============================================================================
create table if not exists auth_activity (
  id           uuid primary key default gen_random_uuid(),
  record_type  text not null,                 -- 'authorization' | 'auth_issue'
  record_id    uuid,
  facility_id  uuid references facilities(id) on delete set null,
  actor_id     uuid references auth.users(id),
  action       text default 'update',         -- create | update | complete
  field        text default '',               -- which field changed (optional)
  worked_on    date not null,                 -- local date of the action
  created_at   timestamptz not null default now()
);
create index if not exists auth_activity_worked_idx on auth_activity(worked_on);
create index if not exists auth_activity_actor_idx  on auth_activity(actor_id);
create index if not exists auth_activity_type_idx   on auth_activity(record_type);

alter table auth_activity enable row level security;

-- Management can read everything; anyone authenticated can log their own action.
drop policy if exists auth_activity_select on auth_activity;
create policy auth_activity_select on auth_activity
  for select using (is_management() or actor_id = auth.uid());
drop policy if exists auth_activity_insert on auth_activity;
create policy auth_activity_insert on auth_activity
  for insert with check (actor_id = auth.uid());

grant select, insert on auth_activity to anon, authenticated;
