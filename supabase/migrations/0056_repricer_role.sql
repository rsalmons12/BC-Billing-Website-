-- ============================================================================
-- Repricer role — a user who works ONLY the repricing tracker, across EVERY
-- facility. A repricer can read + edit repricing everywhere and read the
-- facilities list (so claim facility names resolve), but nothing else.
--
-- Run in the Supabase SQL editor. IMPORTANT: a new enum value must be committed
-- before other statements can use it, so run STEP 1 BY ITSELF first, let it
-- finish, THEN run STEP 2. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — run this single line on its own first:
-- ---------------------------------------------------------------------------
alter type user_role add value if not exists 'repricer';


-- ---------------------------------------------------------------------------
-- STEP 2 — run everything below AFTER step 1 has succeeded:
-- ---------------------------------------------------------------------------
create or replace function is_repricer() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'repricer' from profiles where id = auth.uid()), false);
$$;

-- Repricers can see every facility (needed so repricing claim names + the
-- facility → payer bubbles resolve).
drop policy if exists fac_select on facilities;
create policy fac_select on facilities for select
  using (is_management() or is_repricer() or id in (select accessible_facility_ids()));

-- Read repricing across all facilities.
drop policy if exists repricing_select on repricing;
create policy repricing_select on repricing for select
  using (is_management() or is_repricer() or facility_id in (select accessible_facility_ids()));

-- Edit repricing across all facilities (insert + update). DELETE stays
-- management-only (repricing_delete is left unchanged).
drop policy if exists repricing_insert on repricing;
create policy repricing_insert on repricing for insert
  with check (
    is_repricer()
    or (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))
  );

drop policy if exists repricing_update on repricing;
create policy repricing_update on repricing for update
  using (
    is_repricer()
    or (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))
  )
  with check (
    is_repricer()
    or (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))
  );
