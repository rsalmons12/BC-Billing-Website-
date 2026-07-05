-- Billed is just a visual report now (no claim-id matching / notes). Drop the
-- unique constraint on claim_id so imports can bulk-replace freely; keep a
-- plain index for fast lookups/search.
drop index if exists billed_claims_claim_id_key;
create index if not exists billed_claims_claim_id_idx on billed_claims(claim_id);
