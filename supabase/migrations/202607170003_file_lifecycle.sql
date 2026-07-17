-- Owner-only file replacement support for projects that already applied the
-- initial Filehaven migrations. Display name, folder, visibility, storage path,
-- and ownership remain immutable; only file details may be refreshed.

alter table public.files
  add column if not exists updated_at timestamptz;

update public.files
set updated_at = created_at
where updated_at is null;

alter table public.files
  alter column updated_at set default now(),
  alter column updated_at set not null;

grant update(size_bytes, mime_type, updated_at)
  on public.files
  to authenticated;

drop policy if exists "Owners refresh their file metadata" on public.files;
create policy "Owners refresh their file metadata"
on public.files for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists "Owners replace their stored objects" on storage.objects;
create policy "Owners replace their stored objects"
on storage.objects for update
to authenticated
using (bucket_id = 'downloads' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'downloads' and owner_id = (select auth.uid())::text);
