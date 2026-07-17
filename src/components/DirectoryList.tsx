import { useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { ArrowRight, Download, FileText, Folder, Search } from 'lucide-react';

import { FileActions } from './FileActions';
import { formatBytes, formatDate } from '../lib/format';
import { downloadFile } from '../services/directoryService';
import type { DirectoryContents, FileRecord, FolderRecord } from '../types';

interface DirectoryListProps {
  contents: DirectoryContents;
  failed: boolean;
  loading: boolean;
  onChanged: () => Promise<void>;
  onOpenFolder: (folder: FolderRecord) => void;
  user: User | null;
}

type SortKey = 'name' | 'size' | 'date';
type Item = { type: 'folder'; record: FolderRecord } | { type: 'file'; record: FileRecord };

export function DirectoryList({ contents, failed, loading, onChanged, onOpenFolder, user }: DirectoryListProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const combined: Item[] = [
      ...contents.folders.map((record): Item => ({ type: 'folder', record })),
      ...contents.files.map((record): Item => ({ type: 'file', record }))
    ].filter((item) => !needle || item.record.name.toLocaleLowerCase().includes(needle));

    return combined.sort((left, right) => {
      const direction = sort.direction === 'asc' ? 1 : -1;
      if (sort.key === 'name' && left.type !== right.type) return left.type === 'folder' ? -1 : 1;
      if (sort.key === 'size') {
        const leftSize = left.type === 'file' ? left.record.size_bytes : -1;
        const rightSize = right.type === 'file' ? right.record.size_bytes : -1;
        return (leftSize - rightSize) * direction;
      }
      if (sort.key === 'date') {
        return (Date.parse(itemDate(left)) - Date.parse(itemDate(right))) * direction;
      }
      return left.record.name.localeCompare(right.record.name, undefined, { sensitivity: 'base' }) * direction;
    });
  }, [contents, query, sort]);

  function changeSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  }

  async function startDownload(file: FileRecord) {
    setDownloadId(file.id);
    setError('');
    try {
      await downloadFile(file);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Download failed.');
    } finally {
      setDownloadId(null);
    }
  }

  return (
    <section className={`directory-panel${failed ? ' directory-panel--unavailable' : ''}`} aria-busy={loading} aria-labelledby="directory-heading">
      <div className="directory-toolbar">
        <div><p className="eyebrow">Shared index</p><h2 id="directory-heading">Files & folders</h2></div>
        <label className="search-field">
          <span className="sr-only">Search files and folders</span><Search aria-hidden="true" size={14} />
          <input disabled={loading || failed} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder" type="search" value={query} />
        </label>
      </div>

      {error ? <p className="inline-alert" role="alert">{error}</p> : null}
      <div className="directory-table" role="table" aria-label="Files and folders">
        <div className="directory-row directory-row--head" role="row">
          <SortButton active={sort.key === 'name'} direction={sort.direction} label="Name" onClick={() => changeSort('name')} />
          <SortButton active={sort.key === 'size'} direction={sort.direction} label="Size" onClick={() => changeSort('size')} />
          <SortButton active={sort.key === 'date'} direction={sort.direction} label="Added" onClick={() => changeSort('date')} />
          <span className="sr-only" role="columnheader">Action</span>
        </div>

        {loading || failed ? <DirectorySkeleton failed={failed} /> : null}
        {!loading && !failed && items.length === 0 ? (
          <div className="empty-state"><span aria-hidden="true">∅</span><strong>{query ? 'No matching items' : 'This folder is empty'}</strong><p>{query ? 'Try a different search.' : 'Signed-in members can add the first item.'}</p></div>
        ) : null}

        {!loading && !failed ? items.map((item) => {
          const isFile = item.type === 'file';
          return (
            <div className="directory-row" key={`${item.type}-${item.record.id}`} role="row">
              <div className="name-cell" role="cell">
                <span className={`item-icon item-icon--${item.type}`} aria-hidden="true">{isFile ? <FileText size={16} /> : <Folder size={17} />}</span>
                <div>
                  <button className="item-name" onClick={() => isFile ? void startDownload(item.record) : onOpenFolder(item.record)} type="button">{item.record.name}{isFile ? '' : '/'}</button>
                  <span className="item-meta-mobile">{isFile ? formatBytes(item.record.size_bytes) : 'Folder'}</span>
                </div>
                {item.record.is_private ? <span className="privacy-badge">Private</span> : null}
              </div>
              <span className="size-cell" role="cell">{isFile ? formatBytes(item.record.size_bytes) : '—'}</span>
              <span className="date-cell" role="cell">{formatDate(itemDate(item))}</span>
              {isFile && user?.id === item.record.owner_id ? (
                <FileActions file={item.record} onChanged={onChanged} user={user} />
              ) : (
                <button aria-label={isFile ? `Download ${item.record.name}` : `Open ${item.record.name}`} className="row-action" disabled={downloadId === item.record.id} onClick={() => isFile ? void startDownload(item.record) : onOpenFolder(item.record)} type="button">
                  {downloadId === item.record.id ? '…' : isFile ? <Download size={15} /> : <ArrowRight size={15} />}
                </button>
              )}
            </div>
          );
        }) : null}
      </div>
    </section>
  );
}

function itemDate(item: Item) {
  return item.type === 'file' ? item.record.updated_at || item.record.created_at : item.record.created_at;
}

function SortButton({ active, direction, label, onClick }: { active: boolean; direction: 'asc' | 'desc'; label: string; onClick: () => void }) {
  return <button className="sort-button" onClick={onClick} role="columnheader" type="button">{label} <span aria-hidden="true">{active ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button>;
}

function DirectorySkeleton({ failed }: { failed: boolean }) {
  const widths = ['58%', '42%', '66%', '49%', '61%'];
  return (
    <div className={`directory-skeleton${failed ? ' directory-skeleton--failed' : ''}`} role="status">
      <span className="sr-only">{failed ? 'The folder could not be loaded. Retry is available in the notification.' : 'Loading files and folders.'}</span>
      {widths.map((width, index) => (
        <div aria-hidden="true" className="directory-row skeleton-row" key={width + index}>
          <span className="skeleton-cell skeleton-cell--name">
            <span className="skeleton-block skeleton-block--icon" />
            <span className="skeleton-block skeleton-block--line" style={{ width }} />
          </span>
          <span className="skeleton-block skeleton-cell skeleton-cell--size" />
          <span className="skeleton-block skeleton-cell skeleton-cell--date" />
          <span className="skeleton-block skeleton-cell skeleton-cell--action" />
        </div>
      ))}
    </div>
  );
}
