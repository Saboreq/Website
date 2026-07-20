-- Role-aware administration and folder lifecycle controls.
--
-- Trust boundaries:
--   * private folders are always managed by their actual owner;
--   * public folders are created/renamed/deleted only by owner/admin roles;
--   * only the owner role can promote members to admin;
--   * admins can issue user invites, never admin invites;
--   * recursive folder deletion is exposed only to the service role so the
--     Edge Function can remove Storage objects before deleting metadata.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'user' check (role in ('owner', 'admin', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_single_owner_idx
  on public.profiles (role)
  where role = 'owner';

create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text;
begin
  requested_role := case
    when new.raw_app_meta_data ->> 'app_role' in ('admin', 'user')
      then new.raw_app_meta_data ->> 'app_role'
    else 'user'
  end;

  insert into public.profiles(id, email, role, created_at, updated_at)
  values (new.id, coalesce(new.email, ''), requested_role, new.created_at, now())
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert or update of email on auth.users
for each row execute function private.handle_new_user_profile();

insert into public.profiles(id, email, role, created_at, updated_at)
select id, coalesce(email, ''), 'user', created_at, now()
from auth.users
on conflict (id) do update
set email = excluded.email,
    updated_at = now();

-- The oldest existing account is the deterministic bootstrap owner. A partial
-- unique index prevents a second owner from being created later.
update public.profiles
set role = 'owner', updated_at = now()
where id = (
  select id
  from auth.users
  order by created_at asc, id asc
  limit 1
)
and not exists (select 1 from public.profiles where role = 'owner');

create or replace function private.user_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.role
    from public.profiles p
    where p.id = p_user_id
  ), 'user')
$$;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_role((select auth.uid()))
$$;

create or replace function private.can_manage_folder(p_folder_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when f.is_private then f.owner_id = p_actor_id
      else private.user_role(p_actor_id) in ('owner', 'admin')
    end
    from public.folders f
    where f.id = p_folder_id
  ), false)
$$;

create or replace function private.can_create_folder(
  p_parent_id uuid,
  p_is_private boolean,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_actor_id is null then false
    when p_is_private then
      p_parent_id is null
      or exists (
        select 1
        from public.folders parent
        where parent.id = p_parent_id
          and parent.owner_id = p_actor_id
      )
    else
      private.user_role(p_actor_id) in ('owner', 'admin')
      and (
        p_parent_id is null
        or coalesce((
          with recursive ancestors as (
            select f.id, f.parent_id, f.is_private
            from public.folders f
            where f.id = p_parent_id
            union all
            select parent.id, parent.parent_id, parent.is_private
            from public.folders parent
            join ancestors child on child.parent_id = parent.id
          )
          select bool_and(not is_private)
          from ancestors
        ), false)
      )
  end
$$;

revoke all on function private.handle_new_user_profile() from public;
revoke all on function private.user_role(uuid) from public;
revoke all on function private.current_user_role() from public;
revoke all on function private.can_manage_folder(uuid, uuid) from public;
revoke all on function private.can_create_folder(uuid, boolean, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.can_manage_folder(uuid, uuid) to authenticated;
grant execute on function private.can_create_folder(uuid, boolean, uuid) to authenticated;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create policy "Members read their profile and owners read members"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or private.current_user_role() = 'owner'
);

alter table public.invites
  add column created_by uuid references public.profiles(id) on delete set null,
  add column target_role text not null default 'user' check (target_role in ('admin', 'user'));

create index invites_created_by_idx on public.invites(created_by);

revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;

drop policy if exists "Privileged members read invites" on public.invites;
create policy "Privileged members read invites"
on public.invites for select
to authenticated
using (
  private.current_user_role() = 'owner'
  or (
    private.current_user_role() = 'admin'
    and created_by = (select auth.uid())
    and target_role = 'user'
  )
);

create or replace function public.create_role_invite(
  p_label text default 'Invite',
  p_max_uses integer default 1,
  p_expires_at timestamptz default null,
  p_target_role text default 'user'
)
returns table (
  id uuid,
  label text,
  max_uses integer,
  use_count integer,
  expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz,
  created_by uuid,
  target_role text,
  code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := private.user_role(actor_id);
  generated_code text;
begin
  if actor_id is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can create invites.' using errcode = '42501';
  end if;

  if p_target_role not in ('user', 'admin') then
    raise exception 'Invite role must be user or admin.' using errcode = '22023';
  end if;

  if actor_role = 'admin' and p_target_role <> 'user' then
    raise exception 'Admins can create user invites only.' using errcode = '42501';
  end if;

  if p_max_uses not between 1 and 1000 then
    raise exception 'Max uses must be between 1 and 1000.' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Invite expiry must be in the future.' using errcode = '22023';
  end if;

  generated_code := 'FH-' || upper(encode(extensions.gen_random_bytes(12), 'hex'));

  return query
  insert into public.invites as created_invite(code_hash, label, max_uses, expires_at, created_by, target_role)
  values (
    encode(extensions.digest(generated_code, 'sha256'), 'hex'),
    coalesce(nullif(trim(p_label), ''), 'Invite'),
    p_max_uses,
    p_expires_at,
    actor_id,
    p_target_role
  )
  returning created_invite.id, created_invite.label, created_invite.max_uses, created_invite.use_count,
    created_invite.expires_at, created_invite.disabled_at, created_invite.created_at,
    created_invite.created_by, created_invite.target_role, generated_code;
end;
$$;

create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text := private.user_role(actor_id);
begin
  if actor_role = 'owner' then
    update public.invites
    set disabled_at = coalesce(disabled_at, now())
    where id = p_invite_id;
  elsif actor_role = 'admin' then
    update public.invites
    set disabled_at = coalesce(disabled_at, now())
    where id = p_invite_id
      and created_by = actor_id
      and target_role = 'user';
  else
    raise exception 'Only an owner or admin can revoke invites.' using errcode = '42501';
  end if;

  if not found then
    raise exception 'Invite was not found or cannot be managed by this account.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  if private.current_user_role() <> 'owner' then
    raise exception 'Only the owner can change member roles.' using errcode = '42501';
  end if;

  if p_role not in ('user', 'admin') then
    raise exception 'Member role must be user or admin.' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role, updated_at = now()
  where id = p_user_id
    and role <> 'owner'
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'The owner role cannot be changed.' using errcode = '42501';
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.create_role_invite(text, integer, timestamptz, text) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.create_role_invite(text, integer, timestamptz, text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, text) to authenticated;

revoke all on function public.consume_invite(text, uuid) from service_role;
drop function public.consume_invite(text, uuid);

create function public.consume_invite(p_code_hash text, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_invite_id uuid;
  selected_target_role text;
begin
  update public.invites
  set use_count = use_count + 1
  where code_hash = p_code_hash
    and disabled_at is null
    and (expires_at is null or expires_at > now())
    and use_count < max_uses
  returning id, target_role into selected_invite_id, selected_target_role;

  if selected_invite_id is null then
    return null;
  end if;

  insert into public.invite_redemptions(invite_id, user_id)
  values (selected_invite_id, p_user_id);

  return selected_target_role;
end;
$$;

revoke all on function public.consume_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.consume_invite(text, uuid) to service_role;

drop policy if exists "Members create their own folders" on public.folders;
drop policy if exists "Owners delete their folders" on public.folders;

revoke delete on public.folders from authenticated;
grant update(name) on public.folders to authenticated;

create policy "Role-aware folder creation"
on public.folders for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and private.can_create_folder(parent_id, is_private, (select auth.uid()))
);

create policy "Role-aware folder rename"
on public.folders for update
to authenticated
using (private.can_manage_folder(id, (select auth.uid())))
with check (private.can_manage_folder(id, (select auth.uid())));

create or replace function public.folder_deletion_manifest(
  p_folder_id uuid,
  p_actor_id uuid
)
returns table (storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_owner_id uuid;
  selected_is_private boolean;
begin
  select f.owner_id, f.is_private
  into selected_owner_id, selected_is_private
  from public.folders f
  where f.id = p_folder_id;

  if selected_owner_id is null then
    raise exception 'Folder not found.' using errcode = 'P0002';
  end if;

  if selected_is_private and selected_owner_id <> p_actor_id then
    raise exception 'Private folders can only be deleted by their owner.' using errcode = '42501';
  end if;

  if not selected_is_private and private.user_role(p_actor_id) not in ('owner', 'admin') then
    raise exception 'Public folders can only be deleted by an owner or admin.' using errcode = '42501';
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

revoke all on function public.folder_deletion_manifest(uuid, uuid) from public, anon, authenticated;
grant execute on function public.folder_deletion_manifest(uuid, uuid) to service_role;
