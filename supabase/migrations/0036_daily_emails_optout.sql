-- ============================================================================
-- Per-user switch for the automated daily emails (end-of-day summary + facility
-- recaps). Defaults to TRUE so nothing changes until management turns it off for
-- a specific user in Admin → Users. When false, that user is excluded from the
-- recipient list everywhere the daily emails are sent.
-- ============================================================================
alter table profiles add column if not exists receives_daily_emails boolean not null default true;
