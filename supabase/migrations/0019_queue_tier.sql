-- Per-collector queue tier. 'standard' works everything (100+ first, then
-- 65–99, then younger). 'priority_100' is a dedicated 100+ specialist whose
-- queue shows only 100+ claims, capped by their daily target. Safe to re-run.
alter table profiles add column if not exists queue_tier text default 'standard';
