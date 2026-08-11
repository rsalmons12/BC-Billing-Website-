-- ============================================================================
-- Sticky patient assignment + follow-up date.
--
-- assigned_to : the collector who OWNS a claim's patient. Once a collector
--   works any of a patient's claims, that patient stays theirs across the daily
--   roster re-hash (which is what caused patients to get re-split every day),
--   until the claim is resolved or a manager reassigns it.
--
-- follow_up_date : the date a claim should resurface in the collector's queue.
--   Overrides the flat 14-day rework cycle — the claim rests until this date,
--   then comes back for follow-up.
--
-- Run once in the Supabase SQL editor.
-- ============================================================================
alter table claim_work add column if not exists assigned_to uuid references auth.users(id);
alter table claim_work add column if not exists follow_up_date date;
create index if not exists claim_work_assigned_idx on claim_work(assigned_to);
