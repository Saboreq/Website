import type { User } from '@supabase/supabase-js';

import { formatBytes, sanitizeFileName } from '../lib/format';
import { maxUploadBytes, storageBucket, supabase } from '../lib/supabase';
import type { DirectoryContents, FileRecord, FolderRecord, Visibility } from '../types';

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function fetchDirectory(folderId: string | null): Promise<DirectoryContents> {
  const db = client();
  let foldersQuery = db.from('folders').select('*');
  let filesQuery = db.from('files').select('*');

  foldersQuery = folderId ? foldersQuery.eq('parent_id', folderId) : foldersQuery.is('parent_id', null);
  filesQuery = folderId ? filesQuery.eq('folder_id', folderId) : filesQuery.is('folder_id', null);

  const [foldersResult, filesResult] = await Promise.all([
    foldersQuery.order('name', { ascending: true }),
    filesQuery.order('name', { ascending: true })
  ]);

  if (foldersResult.error) throw foldersResult.error;
  if (filesResult.error) throw filesResult.error;

  return {
    folders: (foldersResult.data ?? []) as FolderRecord[],
    files: (filesResult.data ?? []) as FileRecord[]
  };
}

export async function fetchFolderChain(folderId: string | null): Promise<FolderRecord[]> {
  if (!folderId) return [];

  const db = client();
  const chain: FolderRecord[] = [];
  let currentId: string | null = folderId;

  for (let depth = 0; currentId && depth < 32; depth += 1) {
    const { data, error } = await db.from('folders').select('*').eq('id', currentId).single();
    if (error) throw error;
    const folder = data as FolderRecord;
    chain.unshift(folder);
    currentId = folder.parent_id;
  }

  return chain;
}

export async function createFolder(
  user: User,
  parentId: string | null,
  name: string,
  visibility: Visibility
): Promise<void> {
  const normalizedName = name.normalize('NFKC').trim();
  if (!normalizedName || normalizedName.length > 120 || /[\\/\u0000-\u001f\u007f]/.test(normalizedName)) {
    throw new Error('Folder names must be 1–120 characters and cannot contain slashes.');
  }

  const { error } = await client().from('folders').insert({
    owner_id: user.id,
    parent_id: parentId,
    name: normalizedName,
    is_private: visibility === 'private'
  });
  if (error) throw error;
}

export async function uploadFile(
  user: User,
  folderId: string | null,
  file: File,
  visibility: Visibility,
  onProgress?: (message: string) => void
): Promise<void> {
  validateFile(file);

  const name = sanitizeFileName(file.name);
  if (!name) throw new Error('The selected file needs a valid name.');

  const db = client();
  const id = crypto.randomUUID();
  const storagePath = `${user.id}/${id}/${name}`;

  onProgress?.('Reserving file metadata…');
  const { error: metadataError } = await db.from('files').insert({
    id,
    owner_id: user.id,
    folder_id: folderId,
    name,
    storage_path: storagePath,
    size_bytes: file.size,
    mime_type: file.type || 'application/octet-stream',
    is_private: visibility === 'private'
  });
  if (metadataError) throw metadataError;

  onProgress?.('Uploading to secure storage…');
  const { error: uploadError } = await db.storage.from(storageBucket).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type || 'application/octet-stream',
    upsert: false
  });

  if (uploadError) {
    await db.from('files').delete().eq('id', id);
    throw uploadError;
  }
}

export async function downloadFile(file: FileRecord): Promise<void> {
  const { data, error } = await client().storage.from(storageBucket).createSignedUrl(file.storage_path, 60, {
    download: file.name
  });
  if (error) throw error;
  window.location.assign(data.signedUrl);
}

export async function replaceFile(
  user: User,
  currentFile: FileRecord,
  replacement: File,
  onProgress?: (message: string) => void
): Promise<void> {
  assertFileOwner(user, currentFile);
  validateFile(replacement);

  const db = client();
  const mimeType = replacement.type || 'application/octet-stream';

  onProgress?.('Replacing stored file…');
  const { error: storageError } = await db.storage.from(storageBucket).update(
    currentFile.storage_path,
    replacement,
    {
      cacheControl: '3600',
      contentType: mimeType
    }
  );
  if (storageError) throw storageError;

  onProgress?.('Refreshing file details…');
  const { error: metadataError } = await db
    .from('files')
    .update({
      size_bytes: replacement.size,
      mime_type: mimeType,
      updated_at: new Date().toISOString()
    })
    .eq('id', currentFile.id)
    .eq('owner_id', user.id);

  if (metadataError) {
    throw new Error('The file was replaced, but its displayed details could not be refreshed. Try again.');
  }
}

export async function deleteFile(user: User, file: FileRecord): Promise<void> {
  assertFileOwner(user, file);
  const db = client();

  const { error: storageError } = await db.storage.from(storageBucket).remove([file.storage_path]);
  if (storageError) throw storageError;

  const { error: metadataError } = await db
    .from('files')
    .delete()
    .eq('id', file.id)
    .eq('owner_id', user.id);
  if (metadataError) throw metadataError;
}

function assertFileOwner(user: User, file: FileRecord) {
  if (file.owner_id !== user.id) throw new Error('Only the file owner can perform this action.');
}

function validateFile(file: File) {
  if (file.size <= 0) throw new Error('The selected file is empty.');
  if (file.size > maxUploadBytes) {
    throw new Error(`This file is ${formatBytes(file.size)}; the upload limit is ${formatBytes(maxUploadBytes)}.`);
  }
}
