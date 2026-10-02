-- ============================================================================
-- Flat monthly fee for facilities billed a FIXED dollar amount instead of a
-- percentage of collections (e.g. Medicaid facilities, where a % fee isn't
-- permitted). When flat_fee is set (> 0), the monthly invoice bills that flat
-- amount as the base fee; otherwise it bills billing_rate% of collections.
-- Extra charges and carried-over prior balances still apply on top in both
-- modes. Run once in the Supabase SQL editor.
-- ============================================================================
alter table facilities add column if not exists flat_fee numeric;
