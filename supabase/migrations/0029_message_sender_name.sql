-- ============================================================================
-- Record WHO sent each facility message. sender_id was already stored; this
-- adds the human-readable name captured at send time (like auth_issues'
-- submitted_by_name) so the thread shows "Sent by <employee>" without a join
-- and stays accurate even if the person later changes their name or leaves.
-- Run once in the Supabase SQL editor.
-- ============================================================================
alter table facility_messages add column if not exists sender_name text default '';

-- Backfill existing outbound messages from the sender's current profile name.
update facility_messages m
set sender_name = coalesce(nullif(p.full_name, ''), p.initials, '')
from profiles p
where m.sender_id = p.id
  and coalesce(m.sender_name, '') = '';
