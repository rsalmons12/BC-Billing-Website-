-- Payments accumulate month over month. Each payment row is tagged with the
-- month (YYYY-MM) it belongs to; importing a month replaces only that month's
-- rows for the touched facilities, so uploading June then July keeps both.
alter table payments add column if not exists period text;
create index if not exists payments_period_idx on payments(facility_id, period);
