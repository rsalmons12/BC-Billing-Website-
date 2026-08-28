-- ============================================================================
-- Invoice ledger — one row per facility per month when an invoice is emailed.
-- Powers the "still owes" list, the Paid toggle, and the 7/14/30-day reminder
-- emails for invoices that haven't been paid. Owners manage it; the reminder
-- cron writes via the service role. Run once in the Supabase SQL editor.
-- ============================================================================
create table if not exists invoices (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references facilities(id) on delete cascade,
  period           text not null,                 -- "YYYY-MM"
  amount           numeric not null default 0,    -- fee billed (collected × rate)
  collected        numeric,                       -- reference: collections that month
  rate             numeric,                       -- reference: billing rate %
  sent_at          timestamptz not null default now(),
  paid             boolean not null default false,
  paid_at          timestamptz,
  reminders_sent   int not null default 0,        -- 0=none, 1=7d, 2=14d, 3=30d
  last_reminder_at timestamptz,
  created_at       timestamptz not null default now(),
  unique (facility_id, period)
);
create index if not exists invoices_unpaid_idx on invoices (paid, sent_at);

alter table invoices enable row level security;

-- Owners read/manage the ledger (mark Paid). The reminder cron writes with the
-- service-role client, which bypasses RLS, so no extra insert policy is needed.
drop policy if exists invoices_owner on invoices;
create policy invoices_owner on invoices for all
  using (is_owner()) with check (is_owner());

grant select, insert, update, delete on invoices to anon, authenticated;
