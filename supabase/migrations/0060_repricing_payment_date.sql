-- Appeal-clock support on repricing. The date the payer paid the claim; appeal
-- windows run from this date (Cigna: 90 days, Aetna/GCS: 180 days after payment).
alter table repricing add column if not exists payment_date text;
