-- Track who routed a claim to the auth team (the collector who sent it over).
-- Name is denormalized so the Auth Issues tab can show it without a join.
alter table auth_issues add column if not exists submitted_by uuid references auth.users(id);
alter table auth_issues add column if not exists submitted_by_name text;
