-- ============================================================================
-- Per-facility reimbursement floors (per day) for the daily recap's "patients
-- below reimbursement floor" list. Each facility sets its own PHP / IOP minimum
-- (blank = that level is off for that facility). Run once in the SQL editor.
-- ============================================================================
alter table facilities add column if not exists php_floor numeric;
alter table facilities add column if not exists iop_floor numeric;
alter table facilities add column if not exists op_floor numeric;
