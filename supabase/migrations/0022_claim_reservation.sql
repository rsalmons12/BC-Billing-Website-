-- Reserve a claim to a collector for the day when they pull it from the shared
-- pool, so two collectors never work the same claim. Resets daily (claimed_at).
alter table claim_work add column if not exists claimed_by uuid references auth.users(id);
alter table claim_work add column if not exists claimed_at date;
create index if not exists claim_work_claimed_idx on claim_work(claimed_by, claimed_at);
