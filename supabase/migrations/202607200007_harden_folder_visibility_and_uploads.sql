-- Harden folder ancestry checks and prevent orphaned Storage uploads.
--
-- This forward migration fixes two trust-boundary gaps:
--   * a user must own every private folder in an ancestor chain;
--   * a Storage object can be created only after matching file metadata exists.

create or replace function private.can_access_folder(
  p_folder_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    with recursive ancestors as (
      select f.id, f.parent_id, f.owner_id, f.is_private
      from public.folders f
      where f.id = p_folder_id

      union all

      select parent.id, parent.parent_id, parent.owner_id, parent.is_private
      from public.folders parent
      join ancestors child on child.parent_id = parent.id
    )
    select bool_and(
      case
        when is_private then coalesce(owner_id = p_user_id, false)
        else true
      end
    )
    from ancestors
  ), false)
$$;

create or replace function private.can_manage_folder(
  p_folder_id uuid,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    with recursive ancestors as (
      select f.id, f.parent_id, f.owner_id, f.is_private
      from public.folders f
      where f.id = p_folder_id

      union all

      select parent.id, parent.parent_id, parent.owner_id, parent.is_private
      from public.folders parent
      join ancestors child on child.parent_id = parent.id
    ),
    target as (
      select owner_id
      from ancestors
      where id = p_folder_id
    )
    select
      bool_and(
        case
          when is_private then coalesce(owner_id = p_actor_id, false)
          else true
        end
      )
      and case
        when bool_or(is_private) then
          coalesce((select owner_id = p_actor_id from target), false)
        else
          private.user_role(p_actor_id) in ('owner', 'admin')
      end
    from ancestors
  ), false)
$$;

create or replace function public.folder_deletion_manifest(
  p_folder_id uuid,
  p_actor_id uuid
)
returns table (storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.folders
    where id = p_folder_id
  ) then
    raise exception 'Folder not found.' using errcode = 'P0002';
  end if;

  if not private.can_manage_folder(p_folder_id, p_actor_id) then
    raise exception 'This account cannot delete that folder.' using errcode = '42501';
  end if;

  return query
  with recursive descendants as (
    select f.id
    from public.folders f
    where f.id = p_folder_id

    union all

    select child.id
    from public.folders child
    join descendants parent on child.parent_id = parent.id
  )
  select file.storage_path
  from public.files file
  join descendants folder on file.folder_id = folder.id;
end;
$$;

revoke all on function private.can_access_folder(uuid, uuid) from public;
revoke all on function private.can_manage_folder(uuid, uuid) from public;
revoke all on function public.folder_deletion_manifest(uuid, uuid) from public, anon, authenticated;

grant usage on schema private to anon, authenticated;
grant execute on function private.can_access_folder(uuid, uuid) to anon, authenticated;
grant execute on function private.can_manage_folder(uuid, uuid) to authenticated;
grant execute on function public.folder_deletion_manifest(uuid, uuid) to service_role;

drop policy if exists "Members upload into their namespace" on storage.objects;

create policy "Members upload reserved objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'downloads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.files file
    where file.storage_path = name
      and file.owner_id = (select auth.uid())
  )
);
