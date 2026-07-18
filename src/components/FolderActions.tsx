import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { Folder, FolderOpen, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';

import { useModalFocus } from '../lib/useModalFocus';
import { deleteFolder, renameFolder } from '../services/directoryService';
import type { AppRole, FolderRecord } from '../types';

interface FolderActionsProps {
  folder: FolderRecord;
  onChanged: () => Promise<void>;
  onOpen: () => void;
  role: AppRole;
  user: User;
}

type Operation = 'rename' | 'delete' | null;

export function FolderActions({ folder, onChanged, onOpen, role, user }: FolderActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [name, setName] = useState(folder.name);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useModalFocus<HTMLElement>(Boolean(operation), closeDialog, triggerRef);

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    window.addEventListener('keydown', closeMenu);
    return () => window.removeEventListener('keydown', closeMenu);
  }, [menuOpen]);

  function openOperation(next: Exclude<Operation, null>) {
    setMenuOpen(false);
    setName(folder.name);
    setStatus('');
    setOperation(next);
  }

  function closeDialog() {
    if (busy) return;
    setOperation(null);
    setStatus('');
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    try {
      await renameFolder(user, role, folder, name);
      await onChanged();
      setOperation(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Folder rename failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setStatus('Removing files and folder metadata…');
    try {
      await deleteFolder(user, role, folder);
      await onChanged();
      setOperation(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Folder deletion failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="action-cell">
        <button aria-expanded={menuOpen} aria-haspopup="menu" aria-label={`Actions for folder ${folder.name}`} className="row-action" onClick={() => setMenuOpen((open) => !open)} ref={triggerRef} type="button">
          <MoreHorizontal aria-hidden="true" size={16} />
        </button>
        {menuOpen ? (
          <div className="file-menu" ref={menuRef} role="menu">
            <button onClick={() => { setMenuOpen(false); onOpen(); }} role="menuitem" type="button"><FolderOpen size={14} /> Open folder</button>
            <button onClick={() => openOperation('rename')} role="menuitem" type="button"><Pencil size={14} /> Rename folder</button>
            <button className="file-menu__danger" onClick={() => openOperation('delete')} role="menuitem" type="button"><Trash2 size={14} /> Delete folder</button>
          </div>
        ) : null}
      </div>

      {operation ? (
        <div className="modal-backdrop" onMouseDown={closeDialog} role="presentation">
          <section aria-labelledby="folder-operation-title" aria-modal="true" className={`file-operation-dialog${operation === 'delete' ? ' file-operation-dialog--danger' : ''}`} onMouseDown={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
            <div className="dialog-heading">
              <div><p className="eyebrow">Folder action</p><h2 id="folder-operation-title">{operation === 'rename' ? 'Rename folder' : 'Delete folder'}</h2></div>
              <button aria-label="Close" className="icon-button close-button" disabled={busy} onClick={closeDialog} type="button"><X size={18} /></button>
            </div>
            <div className="current-file-card">
              <span className="item-icon item-icon--folder"><Folder size={16} /></span>
              <div><span>Current folder</span><strong>{folder.name}</strong><small>{folder.is_private ? 'Private · only you can manage it' : 'Public · owner/admin managed'}</small></div>
            </div>
            {operation === 'rename' ? (
              <form className="replacement-form" onSubmit={submitRename}>
                <label className="dialog-field"><span>New folder name</span><input autoFocus maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></label>
                {status ? <p className="form-status form-status--error" role="alert">{status}</p> : null}
                <button className="primary-button" disabled={busy || name.trim() === folder.name} type="submit">{busy ? 'Renaming…' : 'Save new name'}</button>
                <button className="secondary-button" disabled={busy} onClick={closeDialog} type="button">Cancel</button>
              </form>
            ) : (
              <div className="delete-confirmation">
                <p>This permanently removes the folder, every descendant folder, and every stored file inside it. This cannot be undone.</p>
                {status ? <p className="form-status form-status--error" role="status">{status}</p> : null}
                <button className="danger-button" disabled={busy} onClick={() => void confirmDelete()} type="button">{busy ? 'Deleting…' : 'Delete folder permanently'}</button>
                <button className="secondary-button" disabled={busy} onClick={closeDialog} type="button">Cancel</button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
