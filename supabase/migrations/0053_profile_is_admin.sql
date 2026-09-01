-- ============================================================================
-- Admin flag on profiles — a management user who may run the Admin panel
-- (Users, Facilities, assignments) WITHOUT seeing the money side. Distinct from
-- is_owner: owners see everything incl. invoices; admins manage users/facilities
-- but never the Monthly Report / invoices. Run once in the Supabase SQL editor,
-- then flip Admin on the people you want in Admin → Users (owners only can set it).
-- ============================================================================
alter table profiles add column if not exists is_admin boolean not null default false;
