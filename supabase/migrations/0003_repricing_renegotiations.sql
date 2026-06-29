-- ============================================================================
-- Repricing -> Renegotiations layout + note persistence by Claim ID.
-- Run once in the Supabase SQL editor (safe to run even if 0002 already ran).
-- ============================================================================
alter table repricing add column if not exists charge_amount      numeric;
alter table repricing add column if not exists claim_date        text;
alter table repricing add column if not exists amt_allowed        numeric;
alter table repricing add column if not exists additional_payment numeric;
alter table repricing add column if not exists payment_status     text default '';
alter table repricing add column if not exists follow_up          text default '';
alter table repricing add column if not exists note_action        text default '';

-- Claim ID is the stable key so re-imports update facts without wiping the
-- collector's note/follow-up/additional-payment/payment-status.
create unique index if not exists repricing_claim_id_key on repricing(claim_id);
