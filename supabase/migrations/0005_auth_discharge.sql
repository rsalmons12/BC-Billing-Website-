-- ============================================================================
-- Authorization: discharge bucket. Run once in the Supabase SQL editor.
-- ============================================================================
alter table authorizations add column if not exists discharged boolean not null default false;
create index if not exists authorizations_discharged_idx on authorizations(discharged);
