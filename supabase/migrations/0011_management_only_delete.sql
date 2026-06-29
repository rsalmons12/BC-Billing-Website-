-- ============================================================================
-- Enforce "only management can delete" at the database level for the tracker
-- tables. Staff may still SELECT / INSERT / UPDATE the facilities they can
-- access, but DELETE (including the destructive replace-import) is management
-- only. Run once in the Supabase SQL editor (safe to re-run).
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'authorizations','negotiations','medical_records',
    'payments','repricing','weekly_assignments'
  ]
  loop
    -- Drop the old combined ALL-verb write policy (and any prior split ones).
    execute format('drop policy if exists %1$s_write  on %1$s', t);
    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('drop policy if exists %1$s_delete on %1$s', t);

    -- INSERT / UPDATE: any editor (staff or management) on accessible facilities.
    execute format(
      'create policy %1$s_insert on %1$s for insert with check '
      || '(can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))',
      t
    );
    execute format(
      'create policy %1$s_update on %1$s for update using '
      || '(can_edit() and (is_management() or facility_id in (select accessible_facility_ids()))) '
      || 'with check (can_edit() and (is_management() or facility_id in (select accessible_facility_ids())))',
      t
    );

    -- DELETE: management only.
    execute format('create policy %1$s_delete on %1$s for delete using (is_management())', t);
  end loop;
end $$;
