-- ============================================================================
-- Per-facility Square payment link. When set, the facility's invoice email
-- shows a "Pay via Square" button pointing to it. NULL = no button shown.
-- ============================================================================
alter table facilities add column if not exists square_pay_url text;
