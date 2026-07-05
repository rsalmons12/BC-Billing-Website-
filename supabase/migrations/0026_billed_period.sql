-- Billed accumulates by month too. Tag each billed row with the month the
-- report covers so importing a new month adds to the running set and the Month
-- filter can show any month.
alter table billed_claims add column if not exists period text;
create index if not exists billed_claims_period_idx on billed_claims(facility_id, period);
