-- Replace self-referential folder INSERT checks with a private ownership
-- helper. Querying public.folders directly from its own RLS policy causes
-- PostgreSQL error 42P17 for both public and private folder creation.

create or replace function private.current_user_owns_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.folders f
    where f.id = p_folder_id
      and f.owner_id = (select auth.uid())
  )
$$;

revoke all on function private.current_user_owns_folder(uuid) from public;
grant usage on schema private to authenticated;
grant execute
  on function private.current_user_owns_folder(uuid)
  to authenticated;

drop policy if exists "Members create their own folders" on public.folders;
create policy "Members create their own folders"
on public.folders for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and (
    parent_id is null
    or private.current_user_owns_folder(parent_id)
  )
);

-- Use the same non-recursive ownership boundary for uploads into folders.
drop policy if exists "Members create their own file metadata" on public.files;
create policy "Members create their own file metadata"
on public.files for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and storage_path like (select auth.uid())::text || '/%'
  and (
    folder_id is null
    or private.current_user_owns_folder(folder_id)
  )
);
