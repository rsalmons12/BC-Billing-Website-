-- ============================================================================
-- Heartbeat log for the scheduled (cron) jobs. Every time Vercel invokes a cron
-- endpoint, it writes a row here — so management can SEE whether the scheduler
-- is actually calling the jobs, and what happened (sent / skipped / error).
--   • No rows at all  -> Vercel isn't calling the job (a scheduler/plan issue).
--   • "auth FAIL"     -> CRON_SECRET mismatch.
--   • "skipped: …"    -> it ran but a gate stopped the send.
--   • "sent to N"     -> it sent.
-- Run once in the Supabase SQL editor.
-- ============================================================================
create table if not exists cron_log (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  ran_at timestamptz not null default now(),
  detail text
);
create index if not exists cron_log_job_ran_idx on cron_log (job, ran_at desc);

alter table cron_log enable row level security;

-- Management can read the log. Writes come from the service-role client, which
-- bypasses RLS, so no insert policy is needed.
drop policy if exists cron_log_read on cron_log;
create policy cron_log_read on cron_log for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'management')
);
