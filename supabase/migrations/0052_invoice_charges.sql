-- ============================================================================
-- Extra invoice charges — ad-hoc line items (late fee, adjustment, etc.) added
-- on top of the base fee (collections × rate) for a facility's monthly invoice.
-- Keyed by facility + period so they can be added before OR after the invoice is
-- sent; the invoice email, Square pay link, ledger amount, and reminders all
-- include them. Owner-only. Run once in the Supabase SQL editor.
-- ============================================================================
create table if not exists invoice_charges (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  period      text not null,               -- "YYYY-MM"
  label       text not null,               -- e.g. "Late fee"
  amount      numeric not null default 0,  -- dollars (may be negative for a credit)
  created_at  timestamptz not null default now(),
  created_by  uuid
);
create index if not exists invoice_charges_fac_period_idx on invoice_charges (facility_id, period);

alter table invoice_charges enable row level security;

drop policy if exists invoice_charges_owner on invoice_charges;
create policy invoice_charges_owner on invoice_charges for all
  using (is_owner()) with check (is_owner());

grant select, insert, update, delete on invoice_charges to anon, authenticated;
