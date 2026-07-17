create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120 and name !~ '[\\/[:cntrl:]]'),
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  constraint folder_not_own_parent check (id <> parent_id)
);

create unique index folders_unique_root_name
  on public.folders (owner_id, lower(name))
  where parent_id is null;
create unique index folders_unique_child_name
  on public.folders (owner_id, parent_id, lower(name))
  where parent_id is not null;
create index folders_parent_id_idx on public.folders(parent_id);
create index folders_owner_id_idx on public.folders(owner_id);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180 and name !~ '[\\/[:cntrl:]]'),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  mime_type text not null default 'application/octet-stream',
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storage_path_belongs_to_owner check (storage_path like owner_id::text || '/%')
);

create unique index files_unique_root_name
  on public.files (owner_id, lower(name))
  where folder_id is null;
create unique index files_unique_folder_name
  on public.files (owner_id, folder_id, lower(name))
  where folder_id is not null;
create index files_folder_id_idx on public.files(folder_id);
create index files_owner_id_idx on public.files(owner_id);
create index files_public_root_idx on public.files(created_at desc)
  where folder_id is null and is_private = false;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (char_length(code_hash) = 64),
  label text not null default 'Invite',
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  use_count integer not null default 0 check (use_count between 0 and max_uses),
  expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invite_redemptions (
  id bigint generated always as identity primary key,
  invite_id uuid not null references public.invites(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (invite_id, user_id)
);
create index invite_redemptions_user_id_idx on public.invite_redemptions(user_id);

create or replace function private.can_access_folder(p_folder_id uuid, p_user_id uuid)
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
    select bool_or(owner_id = p_user_id) or bool_and(not is_private)
    from ancestors
  ), false)
$$;

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

create or replace function private.can_access_storage_object(p_storage_path text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.files f
    where f.storage_path = p_storage_path
      and (
        f.owner_id = p_user_id
        or (
          not f.is_private
          and (f.folder_id is null or private.can_access_folder(f.folder_id, p_user_id))
        )
      )
  )
$$;

create or replace function public.consume_invite(p_code_hash text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_invite_id uuid;
begin
  update public.invites
  set use_count = use_count + 1
  where code_hash = p_code_hash
    and disabled_at is null
    and (expires_at is null or expires_at > now())
    and use_count < max_uses
  returning id into selected_invite_id;

  if selected_invite_id is null then
    return false;
  end if;

  insert into public.invite_redemptions(invite_id, user_id)
  values (selected_invite_id, p_user_id);
  return true;
end;
$$;

create or replace function public.create_invite(
  p_code text,
  p_label text default 'Invite',
  p_max_uses integer default 1,
  p_expires_at timestamptz default null
)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.invites;
begin
  if char_length(trim(p_code)) < 10 then
    raise exception 'Invite codes must contain at least 10 characters.';
  end if;

  insert into public.invites(code_hash, label, max_uses, expires_at)
  values (
    encode(extensions.digest(upper(trim(p_code)), 'sha256'), 'hex'),
    coalesce(nullif(trim(p_label), ''), 'Invite'),
    p_max_uses,
    p_expires_at
  )
  returning * into created;
  return created;
end;
$$;

revoke all on function private.can_access_folder(uuid, uuid) from public;
revoke all on function private.current_user_owns_folder(uuid) from public;
revoke all on function private.can_access_storage_object(text, uuid) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.can_access_folder(uuid, uuid) to anon, authenticated;
grant execute on function private.current_user_owns_folder(uuid) to authenticated;
grant execute on function private.can_access_storage_object(text, uuid) to anon, authenticated;
revoke all on function public.consume_invite(text, uuid) from public, anon, authenticated;
revoke all on function public.create_invite(text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_invite(text, uuid) to service_role;
grant execute on function public.create_invite(text, text, integer, timestamptz) to service_role;

alter table public.folders enable row level security;
alter table public.files enable row level security;
alter table public.invites enable row level security;
alter table public.invite_redemptions enable row level security;

revoke all on public.folders, public.files, public.invites, public.invite_redemptions from anon, authenticated;
grant select on public.folders, public.files to anon, authenticated;
grant insert, delete on public.folders, public.files to authenticated;
grant update(size_bytes, mime_type, updated_at) on public.files to authenticated;

create policy "Visible folders are readable"
on public.folders for select
to anon, authenticated
using (private.can_access_folder(id, (select auth.uid())));

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

create policy "Owners delete their folders"
on public.folders for delete
to authenticated
using (owner_id = (select auth.uid()));

create policy "Visible files are readable"
on public.files for select
to anon, authenticated
using (
  owner_id = (select auth.uid())
  or (
    not is_private
    and (folder_id is null or private.can_access_folder(folder_id, (select auth.uid())))
  )
);

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

create policy "Owners delete their file metadata"
on public.files for delete
to authenticated
using (owner_id = (select auth.uid()));

create policy "Owners refresh their file metadata"
on public.files for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('downloads', 'downloads', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "Members upload into their namespace"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'downloads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Authorized downloads use metadata visibility"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'downloads'
  and private.can_access_storage_object(name, (select auth.uid()))
);

create policy "Owners delete their stored objects"
on storage.objects for delete
to authenticated
using (bucket_id = 'downloads' and owner_id = (select auth.uid())::text);

create policy "Owners replace their stored objects"
on storage.objects for update
to authenticated
using (bucket_id = 'downloads' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'downloads' and owner_id = (select auth.uid())::text);
