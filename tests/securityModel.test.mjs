import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/202607170001_filehaven.sql', import.meta.url);
const repairMigrationUrl = new URL('../supabase/migrations/202607170002_grant_policy_helpers.sql', import.meta.url);
const lifecycleMigrationUrl = new URL('../supabase/migrations/202607170003_file_lifecycle.sql', import.meta.url);
const folderPolicyMigrationUrl = new URL('../supabase/migrations/202607170004_fix_folder_insert_recursion.sql', import.meta.url);
const functionUrl = new URL('../supabase/functions/register-with-invite/index.ts', import.meta.url);

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
  assert.doesNotMatch(source, /VITE_SUPABASE_SERVICE_ROLE_KEY/);
});
