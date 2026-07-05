-- The single note a collector must write to be pushed into CollaborateMD.
-- Required (enforced in-app) before a claim can be marked worked. Kept
-- separate from `notes` (the running BC log) so the bot pushes ONLY this
-- one update per claim — no duplicating the whole history.
alter table claim_work add column if not exists collab_note text default '';
