-- ============================================================================
-- Attachments tab: two folders (Medical Records, Licenses & W-9) with uploads.
-- Files live in a private Storage bucket; this table holds searchable metadata.
-- ============================================================================

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  category text not null,             -- 'medical_records' | 'licenses_w9'
  name text not null,                 -- original filename (shown + searched)
  path text not null,                 -- object path inside the bucket
  size_bytes bigint,
  content_type text,
  facility_id uuid references facilities(id) on delete set null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists attachments_category_idx on attachments(category);
create index if not exists attachments_created_idx on attachments(created_at);

alter table attachments enable row level security;
drop policy if exists attachments_select on attachments;
create policy attachments_select on attachments for select
  using (auth.uid() is not null);
drop policy if exists attachments_insert on attachments;
create policy attachments_insert on attachments for insert
  with check (can_edit());
drop policy if exists attachments_delete on attachments;
create policy attachments_delete on attachments for delete
  using (is_management());
grant select, insert, update, delete on attachments to authenticated;

-- ---- Private storage bucket ------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Any signed-in user may read/upload; only management may delete objects.
drop policy if exists attachments_obj_read on storage.objects;
create policy attachments_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
drop policy if exists attachments_obj_insert on storage.objects;
create policy attachments_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments');
drop policy if exists attachments_obj_update on storage.objects;
create policy attachments_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'attachments');
drop policy if exists attachments_obj_delete on storage.objects;
create policy attachments_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.is_management());
