-- ============================================================================
-- Owner flag on profiles. An owner is a management user who may ALSO see the
-- money side — the Monthly Report / invoicing screen and the invoice-email
-- action. Managers (role = management, is_owner = false) get every other
-- management tab but never the invoices. Run once in the Supabase SQL editor,
-- then flip your own account (and any co-owner) to owner in Admin → Users.
-- ============================================================================
alter table profiles add column if not exists is_owner boolean not null default false;
