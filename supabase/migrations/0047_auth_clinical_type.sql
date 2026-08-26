-- ============================================================================
-- Authorizations: how the clinical review was submitted — Live, Fax, or
-- Initial Live (first clinical live, subsequent by fax). Run once in the
-- Supabase SQL editor.
-- ============================================================================
alter table authorizations add column if not exists clinical_type text;
