-- ============================================================================
-- Per-day billing color on the weekly census. Each day box can be marked
-- billed (green) / pending (orange) / scholarship (red). Stored as
-- { "YYYY-MM-DD": "billed" }. Run once in the Supabase SQL editor.
-- ============================================================================
alter table census add column if not exists day_status jsonb default '{}'::jsonb;
