-- ============================================================================
-- Per-user tab access. NULL = role default (all tabs the role allows);
-- an array = only those tab keys. Run once in the Supabase SQL editor.
-- ============================================================================
alter table profiles add column if not exists allowed_tabs text[];
