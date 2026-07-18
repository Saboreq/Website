-- GoTrue may write raw_app_meta_data after the initial auth.users INSERT.
-- Keep profile roles synchronized with server-controlled app metadata without
-- allowing a metadata update to overwrite the singleton owner role.

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
      role = case
        when profiles.role = 'owner' then 'owner'
        when requested_role = 'admin' then 'admin'
        else profiles.role
      end,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert or update of email, raw_app_meta_data on auth.users
for each row execute function private.handle_new_user_profile();

update public.profiles profile
set role = 'admin', updated_at = now()
from auth.users auth_user
where profile.id = auth_user.id
  and profile.role <> 'owner'
  and auth_user.raw_app_meta_data ->> 'app_role' = 'admin';

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

  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role <> 'owner'
  ) then
    raise exception 'The owner role cannot be changed.' using errcode = '42501';
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('app_role', p_role)
  where id = p_user_id;

  update public.profiles
  set role = p_role, updated_at = now()
  where id = p_user_id
  returning * into updated_profile;

  return updated_profile;
end;
$$;

revoke all on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

