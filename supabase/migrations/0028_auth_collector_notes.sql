-- ============================================================================
-- Carry the collector's notes onto the auth issue when a claim is routed to
-- the auth team. `notes` stays the auth team's own working notes; the
-- collector's original context lives in `collector_notes` (read-only in the
-- Auth Issues tab and Management tab). Run once in the Supabase SQL editor.
-- ============================================================================
alter table auth_issues add column if not exists collector_notes text default '';
