-- ============================================================================
-- Authorizations: primary diagnosis code + billing CPT code.
-- Run once in the Supabase SQL editor.
-- ============================================================================
alter table authorizations add column if not exists dx_code_primary  text;
alter table authorizations add column if not exists billing_cpt_code text;
