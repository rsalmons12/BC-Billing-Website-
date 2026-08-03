-- ============================================================================
-- Per-facility billing rate: the percentage of monthly collections BC Billing
-- charges that facility. Each facility can differ. Used to generate the invoice
-- on the Monthly Report (fee = collected × billing_rate%). NULL = not set yet.
-- ============================================================================
alter table facilities add column if not exists billing_rate numeric;
