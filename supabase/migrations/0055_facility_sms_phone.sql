-- ============================================================================
-- Facility SMS number. Where the weekly census text recap is sent for each
-- facility. NULL = no text is sent for that facility. Run once in Supabase.
-- ============================================================================
alter table facilities add column if not exists sms_phone text;
