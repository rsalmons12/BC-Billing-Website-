-- ============================================================================
-- Billed claims: per-claim level-of-care units, summed from the billed report's
-- "CPT Default Units (Sum)" column by CPT code. e.g. a claim with S0201 x3 →
-- {"PHP": 3}. Powers the "Services billed by level of care" counts in the Money
-- Outlook (S0201/H0035 = PHP, H0015/S9480 = IOP, 90853 = OP). Money totals stay
-- one row per claim; only the day counts come from these units.
-- ============================================================================
alter table billed_claims add column if not exists loc_units jsonb;
