-- ============================================================================
-- Census billing dollars, counted per GN. gn_rate = $ per GN session;
-- expected amount is computed (GN sessions × rate); paid_amount is entered.
-- Run once in the Supabase SQL editor.
-- ============================================================================
alter table census add column if not exists gn_rate     numeric;
alter table census add column if not exists paid_amount numeric;
