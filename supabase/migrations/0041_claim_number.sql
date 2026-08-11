-- ============================================================================
-- Dedicated Claim # (payer claim number) and optional Reference # on each claim,
-- so the claim number lives in its own field instead of getting buried in notes.
-- Run once in the Supabase SQL editor.
-- ============================================================================
alter table claim_work add column if not exists claim_number text default '';
alter table claim_work add column if not exists reference_number text default '';
