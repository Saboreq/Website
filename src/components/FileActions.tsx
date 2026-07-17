import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { Download, FileText, MoreHorizontal, RefreshCw, Trash2, UploadCloud, X } from 'lucide-react';

import { formatBytes } from '../lib/format';
import { useModalFocus } from '../lib/useModalFocus';
import { deleteFile, downloadFile, replaceFile } from '../services/directoryService';
import type { FileRecord } from '../types';

interface FileActionsProps {
  file: FileRecord;
  onChanged: () => Promise<void>;
  user: User;
}

type Operation = 'replace' | 'delete' | null;

export function FileActions({ file, onChanged, user }: FileActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useModalFocus<HTMLElement>(Boolean(operation), closeDialog, actionTriggerRef);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setStatus('');
      actionTriggerRef.current?.focus();
    };
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  function openOperation(nextOperation: Exclude<Operation, null>) {
    setMenuOpen(false);
    setOperation(nextOperation);
    setReplacement(null);
    setStatus('');
  }

  function closeDialog() {
    if (busy) return;
    setOperation(null);
    setReplacement(null);
    setStatus('');
  }

  async function startDownload() {
    setBusy(true);
    setStatus('');
    try {
      await downloadFile(file);
      setMenuOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReplacement(event: FormEvent) {
    event.preventDefault();
    if (!replacement) {
      setStatus('Choose a replacement file first.');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      await replaceFile(user, file, replacement, setStatus);
      await onChanged();
      closeAfterSuccess();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Replacement failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setStatus('Removing stored file…');
    try {
      await deleteFile(user, file);
      await onChanged();
      closeAfterSuccess();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  function closeAfterSuccess() {
    setOperation(null);
    setReplacement(null);
    setStatus('');
  }

  return (
    <>
      <div className="action-cell">
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Actions for ${file.name}`}
          className="row-action"
          onClick={() => { setMenuOpen((open) => !open); setStatus(''); }}
          ref={actionTriggerRef}
          type="button"
        >
          <MoreHorizontal aria-hidden="true" size={16} />
        </button>
        {menuOpen ? (
          <div className="file-menu" ref={menuRef} role="menu">
            <button disabled={busy} onClick={() => void startDownload()} role="menuitem" type="button"><Download size={14} /> Download</button>
            <button onClick={() => openOperation('replace')} role="menuitem" type="button"><RefreshCw size={14} /> Replace file</button>
            <button className="file-menu__danger" onClick={() => openOperation('delete')} role="menuitem" type="button"><Trash2 size={14} /> Delete file</button>
            {status ? <p role="alert">{status}</p> : null}
          </div>
        ) : null}
      </div>

      {operation ? (
        <div className="modal-backdrop" onMouseDown={closeDialog} role="presentation">
          <section
            aria-labelledby="file-operation-title"
            aria-modal="true"
            className={`file-operation-dialog${operation === 'delete' ? ' file-operation-dialog--danger' : ''}`}
            onMouseDown={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Owner action</p>
                <h2 id="file-operation-title">{operation === 'replace' ? 'Replace file' : 'Delete file'}</h2>
              </div>
              <button aria-label="Close" className="icon-button close-button" disabled={busy} onClick={closeDialog} type="button"><X size={18} /></button>
            </div>

            <div className="current-file-card">
              <span className="item-icon item-icon--file"><FileText size={16} /></span>
              <div><span>Current file</span><strong>{file.name}</strong><small>{formatBytes(file.size_bytes)} · {file.is_private ? 'Private' : 'Public'}</small></div>
            </div>

            {operation === 'replace' ? (
              <form className="replacement-form" onSubmit={submitReplacement}>
                <label className="file-drop file-drop--dialog" htmlFor={`replacement-${file.id}`}>
                  <UploadCloud aria-hidden="true" size={22} />
                  <span>{replacement ? replacement.name : 'Choose the new file'}</span>
                  <small>{replacement ? `${formatBytes(replacement.size)} · published as ${file.name}` : 'Filename, folder, owner, and visibility stay unchanged'}</small>
                  <input id={`replacement-${file.id}`} onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} type="file" />
                </label>
                {status ? <p className="form-status" role="status">{status}</p> : null}
                <button className="primary-button" disabled={busy || !replacement} type="submit">{busy ? 'Replacing…' : 'Replace file'}</button>
                <button className="secondary-button" disabled={busy} onClick={closeDialog} type="button">Cancel</button>
              </form>
            ) : (
              <div className="delete-confirmation">
                <p>This permanently removes the stored object and its listing. This action cannot be undone.</p>
                {status ? <p className="form-status form-status--error" role="status">{status}</p> : null}
                <button className="danger-button" disabled={busy} onClick={() => void confirmDelete()} type="button">{busy ? 'Deleting…' : 'Delete permanently'}</button>
                <button className="secondary-button" disabled={busy} onClick={closeDialog} type="button">Cancel</button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
