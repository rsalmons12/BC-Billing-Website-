-- ============================================================================
-- "Resolve / close out" a claim from the queue. A resolved claim is finished
-- work — it leaves the active queue/collections board but stays in the data
-- and is counted in Reporting (closed-out claims per collector).
-- Run once in the Supabase SQL editor (safe to re-run).
-- ============================================================================
alter table claim_work add column if not exists resolved    boolean default false;
alter table claim_work add column if not exists resolved_at  timestamptz;
alter table claim_work add column if not exists resolved_by  uuid references auth.users(id);

create index if not exists claim_work_resolved_at_idx on claim_work(resolved_at);
