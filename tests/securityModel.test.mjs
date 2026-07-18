import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/202607170001_filehaven.sql', import.meta.url);
const repairMigrationUrl = new URL('../supabase/migrations/202607170002_grant_policy_helpers.sql', import.meta.url);
const lifecycleMigrationUrl = new URL('../supabase/migrations/202607170003_file_lifecycle.sql', import.meta.url);
const folderPolicyMigrationUrl = new URL('../supabase/migrations/202607170004_fix_folder_insert_recursion.sql', import.meta.url);
const administrationMigrationUrl = new URL('../supabase/migrations/202607170005_role_aware_administration.sql', import.meta.url);
const roleSyncMigrationUrl = new URL('../supabase/migrations/202607170006_sync_profile_roles.sql', import.meta.url);
const functionUrl = new URL('../supabase/functions/register-with-invite/index.ts', import.meta.url);
const folderFunctionUrl = new URL('../supabase/functions/manage-folder/index.ts', import.meta.url);

test('database migration keeps file metadata and storage behind RLS', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /alter table public\.files enable row level security/i);
  assert.match(sql, /private\.can_access_storage_object/i);
  assert.match(sql, /bucket_id = 'downloads'/i);
  assert.match(sql, /not f\.is_private/i);
  assert.match(sql, /storage_path like owner_id::text/i);
  assert.match(sql, /grant usage on schema private to anon, authenticated/i);
  assert.match(sql, /grant execute on function private\.can_access_folder\(uuid, uuid\) to anon, authenticated/i);
  assert.match(sql, /owner_id = \(select auth\.uid\(\)\)[\s\S]*or[\s\S]*not is_private/i);
  assert.match(sql, /Owners delete their file metadata[\s\S]*owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /Owners delete their stored objects[\s\S]*owner_id = \(select auth\.uid\(\)\)::text/i);
});

test('forward migration repairs RLS helper permissions on deployed projects', async () => {
  const sql = await readFile(repairMigrationUrl, 'utf8');
  assert.match(sql, /grant usage on schema private to anon, authenticated/i);
  assert.match(sql, /private\.can_access_folder\(uuid, uuid\)/i);
  assert.match(sql, /private\.can_access_storage_object\(text, uuid\)/i);
  assert.doesNotMatch(sql, /grant .* on (table|all tables)/i);
});

test('file lifecycle migration limits replacement to owner-controlled content fields', async () => {
  const sql = await readFile(lifecycleMigrationUrl, 'utf8');
  assert.match(sql, /grant update\(size_bytes, mime_type, updated_at\)/i);
  assert.match(sql, /Owners refresh their file metadata[\s\S]*using \(owner_id = \(select auth\.uid\(\)\)\)[\s\S]*with check \(owner_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /Owners replace their stored objects[\s\S]*bucket_id = 'downloads'[\s\S]*owner_id = \(select auth\.uid\(\)\)::text/i);
  assert.doesNotMatch(sql, /grant update on public\.files/i);
});

test('folder inserts use a non-recursive owner check for public and private folders', async () => {
  const sql = await readFile(folderPolicyMigrationUrl, 'utf8');
  assert.match(sql, /create or replace function private\.current_user_owns_folder/i);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/i);
  assert.match(sql, /f\.owner_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /revoke all on function private\.current_user_owns_folder\(uuid\) from public/i);
  assert.match(sql, /grant execute[\s\S]*private\.current_user_owns_folder\(uuid\)[\s\S]*to authenticated/i);
  assert.match(sql, /Members create their own folders[\s\S]*parent_id is null[\s\S]*private\.current_user_owns_folder\(parent_id\)/i);
  assert.doesNotMatch(sql, /select 1 from public\.folders parent/i);
});

test('registration function uses server admin auth and consumes a hashed invite', async () => {
  const source = await readFile(functionUrl, 'utf8');
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(source, /auth\.admin\.createUser/);
  assert.match(source, /rpc\('consume_invite'/);
  assert.match(source, /app_metadata:\s*\{ app_role: invite\.target_role \}/);
  assert.match(source, /consumed !== invite\.target_role/);
  assert.doesNotMatch(source, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
});

test('role migration preserves private ownership and limits public folder lifecycle', async () => {
  const sql = await readFile(administrationMigrationUrl, 'utf8');
  assert.match(sql, /role in \('owner', 'admin', 'user'\)/i);
  assert.match(sql, /when f\.is_private then f\.owner_id = p_actor_id/i);
  assert.match(sql, /else private\.user_role\(p_actor_id\) in \('owner', 'admin'\)/i);
  assert.match(sql, /when p_is_private[\s\S]*parent\.owner_id = p_actor_id/i);
  assert.match(sql, /when p_is_private[\s\S]*private\.user_role\(p_actor_id\) in \('owner', 'admin'\)/i);
  assert.match(sql, /revoke delete on public\.folders from authenticated/i);
  assert.match(sql, /grant update\(name\) on public\.folders to authenticated/i);
  assert.match(sql, /folder_deletion_manifest[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.folder_deletion_manifest[\s\S]*to authenticated/i);
});

test('invite and member administration enforce the owner-admin hierarchy', async () => {
  const sql = await readFile(administrationMigrationUrl, 'utf8');
  assert.match(sql, /actor_role = 'admin' and p_target_role <> 'user'/i);
  assert.match(sql, /private\.current_user_role\(\) <> 'owner'[\s\S]*Only the owner can change member roles/i);
  assert.match(sql, /p_role not in \('user', 'admin'\)/i);
  assert.match(sql, /code_hash[\s\S]*extensions\.digest\(generated_code, 'sha256'\)/i);
  assert.doesNotMatch(sql, /add column code\s+text/i);
});

test('folder deletion function authenticates the caller before using the service role', async () => {
  const source = await readFile(folderFunctionUrl, 'utf8');
  assert.match(source, /caller\.auth\.getUser\(\)/);
  assert.match(source, /p_actor_id: identity\.user\.id/);
  assert.match(source, /rpc\('folder_deletion_manifest'/);
  assert.match(source, /storage[\s\S]*\.remove\(/);
  assert.match(source, /from\('folders'\)[\s\S]*\.delete/);
  assert.doesNotMatch(source, /const\s*\{[^}]*actor(?:Id|_id)[^}]*\}\s*=\s*await request\.json/i);
});

test('profile roles follow server-written auth metadata and owner role changes stay synchronized', async () => {
  const sql = await readFile(roleSyncMigrationUrl, 'utf8');
  assert.match(sql, /update of email, raw_app_meta_data on auth\.users/i);
  assert.match(sql, /when profiles\.role = 'owner' then 'owner'/i);
  assert.match(sql, /when requested_role = 'admin' then 'admin'/i);
  assert.match(sql, /update auth\.users[\s\S]*jsonb_build_object\('app_role', p_role\)/i);
  assert.match(sql, /private\.current_user_role\(\) <> 'owner'/i);
});
