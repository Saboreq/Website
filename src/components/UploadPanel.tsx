import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';

import { createFolder, uploadFile } from '../services/directoryService';
import type { Visibility } from '../types';

interface UploadPanelProps {
  canCreatePrivateFolder: boolean;
  canCreatePublicFolder: boolean;
  canUploadFiles: boolean;
  currentFolderId: string | null;
  onChanged: () => Promise<void>;
  user: User;
}

export function UploadPanel({ canCreatePrivateFolder, canCreatePublicFolder, canUploadFiles, currentFolderId, onChanged, user }: UploadPanelProps) {
  const [mode, setMode] = useState<'file' | 'folder'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [folderName, setFolderName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canUploadFiles && mode === 'file') setMode('folder');
    if (mode !== 'folder') return;
    if (!canCreatePublicFolder) setVisibility('private');
    else if (!canCreatePrivateFolder) setVisibility('public');
  }, [canCreatePrivateFolder, canCreatePublicFolder, canUploadFiles, mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus('');

    try {
      if (mode === 'file') {
        if (!canUploadFiles) throw new Error('Only this folder owner can upload files here.');
        if (!file) throw new Error('Choose a file first.');
        await uploadFile(user, currentFolderId, file, visibility, setStatus);
        setFile(null);
        const input = document.querySelector<HTMLInputElement>('#file-upload');
        if (input) input.value = '';
      } else {
        const folderVisibility = !canCreatePublicFolder ? 'private' : !canCreatePrivateFolder ? 'public' : visibility;
        await createFolder(user, currentFolderId, folderName, folderVisibility);
        setFolderName('');
      }

      setStatus(mode === 'file' ? 'Upload complete.' : 'Folder created.');
      await onChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The operation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="upload-panel" aria-labelledby="upload-heading">
      <div>
        <p className="eyebrow">Workspace</p>
        <h2 id="upload-heading">Add something</h2>
      </div>
      <div className="segmented-control segmented-control--compact" aria-label="Create type">
        <button aria-pressed={mode === 'file'} disabled={!canUploadFiles} onClick={() => setMode('file')} type="button">Upload file</button>
        <button aria-pressed={mode === 'folder'} onClick={() => { setMode('folder'); if (!canCreatePublicFolder) setVisibility('private'); else if (!canCreatePrivateFolder) setVisibility('public'); }} type="button">New folder</button>
      </div>

      <form className="upload-form" onSubmit={submit}>
        {mode === 'file' ? (
          <label className="file-drop" htmlFor="file-upload">
            <span className="file-drop__mark">＋</span>
            <span>{file ? file.name : 'Choose a file'}</span>
            <small>{file ? 'Ready to upload' : 'Up to the configured storage limit'}</small>
            <input id="file-upload" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
          </label>
        ) : (
          <label>
            <span>Folder name</span>
            <input maxLength={120} onChange={(event) => setFolderName(event.target.value)} required value={folderName} />
          </label>
        )}

        <fieldset className="visibility-picker">
          <legend>Visibility</legend>
          <label>
            <input checked={visibility === 'public'} disabled={mode === 'folder' && !canCreatePublicFolder} name="visibility" onChange={() => setVisibility('public')} type="radio" />
            <span><strong>Public</strong><small>{mode === 'folder' && !canCreatePublicFolder ? 'Only owner/admin accounts can create public folders.' : 'Anyone with access to the site can download it.'}</small></span>
          </label>
          <label>
            <input checked={visibility === 'private'} disabled={mode === 'folder' && !canCreatePrivateFolder} name="visibility" onChange={() => setVisibility('private')} type="radio" />
            <span><strong>Private</strong><small>{mode === 'folder' && !canCreatePrivateFolder ? 'Private children require a folder you own.' : 'Only you can see and download it.'}</small></span>
          </label>
        </fieldset>

        {status ? <p className="form-status" role="status">{status}</p> : null}
        <button className="primary-button" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'file' ? 'Upload file' : 'Create folder'}
        </button>
      </form>
    </aside>
  );
}
