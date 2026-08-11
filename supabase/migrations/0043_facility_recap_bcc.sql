-- ============================================================================
-- Per-facility BCC for the daily recap email. Comma-separated list of addresses
-- that get blind-copied on THIS facility's daily recap only (in addition to the
-- management BCC). Leave blank for facilities that shouldn't have an extra BCC.
-- Run once in the Supabase SQL editor.
-- ============================================================================
alter table facilities add column if not exists recap_bcc text;
