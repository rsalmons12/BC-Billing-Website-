-- ============================================================================
-- Management SMS number. A management user with a number here receives EVERY
-- facility's weekly census text (like being BCC'd on the email recaps). May
-- hold several numbers separated by commas. Run once in Supabase.
-- ============================================================================
alter table profiles add column if not exists sms_phone text;
