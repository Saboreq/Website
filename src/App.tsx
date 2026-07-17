import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { AuthPanel } from './components/AuthPanel';
import { DirectoryList } from './components/DirectoryList';
import { UploadPanel } from './components/UploadPanel';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { fetchDirectory, fetchFolderChain } from './services/directoryService';
import type { DirectoryContents, FolderRecord } from './types';

const emptyContents: DirectoryContents = { folders: [], files: [] };
const folderIdFromUrl = () => new URLSearchParams(window.location.search).get('folder');

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(folderIdFromUrl);
  const [folderChain, setFolderChain] = useState<FolderRecord[]>([]);
  const [contents, setContents] = useState<DirectoryContents>(emptyContents);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [loadError, setLoadError] = useState('');

  const currentFolder = folderChain.at(-1) ?? null;
  const canAddHere = Boolean(session?.user && (!currentFolder || currentFolder.owner_id === session.user.id));

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setLoadError('');
    try {
      const [nextContents, nextChain] = await Promise.all([fetchDirectory(currentFolderId), fetchFolderChain(currentFolderId)]);
      setContents(nextContents);
      setFolderChain(nextChain);
    } catch (error) {
      setContents(emptyContents);
      setFolderChain([]);
      setLoadError(error instanceof Error ? error.message : 'Could not load this directory.');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => { void refresh(); }, [refresh, session?.user.id]);

  useEffect(() => {
    const onPopState = () => setCurrentFolderId(folderIdFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(folder: FolderRecord | null) {
    const id = folder?.id ?? null;
    window.history.pushState({}, '', id ? `/?folder=${encodeURIComponent(id)}` : '/');
    setCurrentFolderId(id);
  }

  const visibleEmail = useMemo(() => session?.user.email ?? 'Member', [session]);

  return (
    <div className="site-shell">
      <div className="ambient-background" aria-hidden="true">
        <span className="ambient-background__aurora" />
        <span className="ambient-background__beam" />
        <span className="ambient-background__grain" />
      </div>
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate(null); }}><span className="brand-mark" aria-hidden="true">F</span><span>Filehaven</span></a>
        <nav aria-label="Account">
          {session ? <div className="account-actions"><span className="account-email">{visibleEmail}</span><button className="ghost-button" onClick={() => void supabase?.auth.signOut()} type="button">Sign out</button></div>
            : <button className="ghost-button" disabled={!isSupabaseConfigured} onClick={() => setAuthOpen(true)} type="button">Member sign in</button>}
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy"><p className="eyebrow"><span className="status-dot" /> Secure shared storage</p><h1>Your files, hosted<br />without the friction.</h1><p>Browse public downloads freely. Members can organize uploads and keep sensitive files private.</p></div>
        </section>

        {!isSupabaseConfigured ? <section className="setup-notice" aria-labelledby="setup-title"><span className="setup-notice__mark" aria-hidden="true">!</span><div><p className="eyebrow">Setup required</p><h2 id="setup-title">Connect this build to Supabase</h2><p>Copy <code>.env.example</code> to <code>.env.local</code>, add the project URL and publishable key, then apply the included migration.</p></div></section> : null}

        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <button onClick={() => navigate(null)} type="button">Root</button>
          {folderChain.map((folder) => <span key={folder.id}><span aria-hidden="true">/</span><button onClick={() => navigate(folder)} type="button">{folder.name}</button></span>)}
        </nav>

        {loadError ? <p className="inline-alert" role="alert">{loadError}</p> : null}
        <div className={canAddHere ? 'content-grid' : 'content-grid content-grid--single'}>
          <DirectoryList contents={contents} loading={loading} onChanged={refresh} onOpenFolder={navigate} user={session?.user ?? null} />
          {canAddHere && session ? <UploadPanel currentFolderId={currentFolderId} onChanged={refresh} user={session.user} /> : null}
        </div>
        {session && currentFolder && currentFolder.owner_id !== session.user.id ? <p className="visitor-note">You are viewing another member’s public folder. Only its owner can add items here.</p> : null}
      </main>

      <footer>
        <span>Filehaven</span>
        <span className="developer-credit">Developed by <a href="https://saboreq.xyz" rel="noreferrer" target="_blank">Saboreq</a></span>
        <span>Short-lived links · Owner-only private access</span>
      </footer>
      {authOpen ? <AuthPanel onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}
