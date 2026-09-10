-- ============================================================================
-- Partial invoice payments. Adds a running "paid so far" amount to the invoice
-- ledger so an invoice can be part-paid and still show a remaining balance
-- (balance = amount - paid_amount). The Paid checkbox = fully paid; recording a
-- payment >= the amount also flips paid to true. Reminders bill the balance.
-- Run once in the Supabase SQL editor.
-- ============================================================================
alter table invoices
  add column if not exists paid_amount numeric not null default 0;

-- Backfill: any invoice already marked fully paid counts its whole amount as
-- paid, so the new Balance column reads $0 for them.
update invoices set paid_amount = amount where paid = true and paid_amount = 0;
