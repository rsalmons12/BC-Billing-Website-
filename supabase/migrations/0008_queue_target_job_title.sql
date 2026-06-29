-- ============================================================================
-- Collection Queue: per-collector customizable daily target + staff job title.
-- Run once in the Supabase SQL editor (safe to re-run).
-- ============================================================================
alter table profiles add column if not exists daily_target int default 100;
alter table profiles add column if not exists job_title   text default 'Collector';

-- Backfill any existing rows that predate these columns.
update profiles set daily_target = 100        where daily_target is null;
update profiles set job_title    = 'Collector' where job_title is null;
