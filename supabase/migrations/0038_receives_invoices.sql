-- ============================================================================
-- Per-user switch for who receives facility INVOICE emails (from the Monthly
-- Report). Defaults to FALSE — invoices go only to users you explicitly mark
-- in Admin → Users (e.g. only Kevin).
-- ============================================================================
alter table profiles add column if not exists receives_invoices boolean not null default false;
