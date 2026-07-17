-- Repair for projects that already applied 202607170001_filehaven.sql.
-- These helpers are referenced from RLS policies, so the request roles need
-- schema lookup and function execution privileges. The private schema remains
-- outside PostgREST's exposed schemas and no table access is granted here.

grant usage on schema private to anon, authenticated;

grant execute
  on function private.can_access_folder(uuid, uuid)
  to anon, authenticated;

grant execute
  on function private.can_access_storage_object(text, uuid)
  to anon, authenticated;
