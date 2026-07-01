-- Number of days approved on an authorization (e.g. 10 days of PHP). Powers the
-- per-level-of-care day totals on the patient drill-down in the Auth tab.
alter table authorizations add column if not exists total_days int;
