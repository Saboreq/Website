import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { AuthPanel } from './components/AuthPanel';
import { DirectoryList } from './components/DirectoryList';
import { StatusToast } from './components/StatusToast';
import { UploadPanel } from './components/UploadPanel';
import { WelcomeGate } from './components/WelcomeGate';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { fetchDirectory, fetchFolderChain } from './services/directoryService';
import type { DirectoryContents, FolderRecord } from './types';

const emptyContents: DirectoryContents = { folders: [], files: [] };
const folderIdFromUrl = () => new URLSearchParams(window.location.search).get('folder');
type EntryState = 'welcome' | 'leaving' | 'entered';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(folderIdFromUrl);
  const [folderChain, setFolderChain] = useState<FolderRecord[]>([]);
  const [contents, setContents] = useState<DirectoryContents>(emptyContents);
  const [entryState, setEntryState] = useState<EntryState>('welcome');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notificationVisible, setNotificationVisible] = useState(false);
  const entryTimerRef = useRef<number | null>(null);
  const firstLoadRef = useRef(true);

  const currentFolder = folderChain.at(-1) ?? null;
  const canAddHere = Boolean(session?.user && (!currentFolder || currentFolder.owner_id === session.user.id));

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const startedAt = performance.now();
    const minimumLoadingTime = firstLoadRef.current ? 620 : 0;
    setLoading(true);
    setLoadError('');
    setNotificationVisible(false);
    try {
      const [nextContents, nextChain] = await Promise.all([fetchDirectory(currentFolderId), fetchFolderChain(currentFolderId)]);
      setContents(nextContents);
      setFolderChain(nextChain);
    } catch (error) {
      setContents(emptyContents);
      setFolderChain([]);
      setLoadError(error instanceof Error ? error.message : 'Could not load this directory.');
      setNotificationVisible(true);
    } finally {
      const remainingTime = minimumLoadingTime - (performance.now() - startedAt);
      if (remainingTime > 0) await new Promise((resolve) => window.setTimeout(resolve, remainingTime));
      firstLoadRef.current = false;
      setLoading(false);
    }
  }, [currentFolderId]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (entryState === 'entered') void refresh();
  }, [entryState, refresh, session?.user.id]);

  useEffect(() => {
    if (entryState === 'entered') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [entryState]);

  useEffect(() => () => {
    if (entryTimerRef.current !== null) window.clearTimeout(entryTimerRef.current);
  }, []);

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

  function enterWorkspace() {
    if (entryState !== 'welcome') return;
    setEntryState('leaving');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    entryTimerRef.current = window.setTimeout(() => setEntryState('entered'), reducedMotion ? 0 : 460);
  }

  const visibleEmail = useMemo(() => session?.user.email ?? 'Member', [session]);

  return (
    <>
    <div
      aria-hidden={entryState !== 'entered' ? true : undefined}
      className={`site-shell site-shell--${entryState}`}
      inert={entryState !== 'entered'}
    >
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

      <main className="workspace-main">
        {!isSupabaseConfigured ? <section className="setup-notice" aria-labelledby="setup-title"><span className="setup-notice__mark" aria-hidden="true">!</span><div><p className="eyebrow">Setup required</p><h2 id="setup-title">Connect this build to Supabase</h2><p>Copy <code>.env.example</code> to <code>.env.local</code>, add the project URL and publishable key, then apply the included migration.</p></div></section> : null}

        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <button onClick={() => navigate(null)} type="button">Root</button>
          {folderChain.map((folder) => <span key={folder.id}><span aria-hidden="true">/</span><button onClick={() => navigate(folder)} type="button">{folder.name}</button></span>)}
        </nav>

        <div className={canAddHere ? 'content-grid' : 'content-grid content-grid--single'}>
          <DirectoryList contents={contents} failed={Boolean(loadError)} loading={loading} onChanged={refresh} onOpenFolder={navigate} user={session?.user ?? null} />
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
    {entryState !== 'entered' ? <WelcomeGate leaving={entryState === 'leaving'} onEnter={enterWorkspace} /> : null}
    {notificationVisible ? <StatusToast onDismiss={() => setNotificationVisible(false)} onRetry={() => void refresh()} /> : null}
    </>
  );
}
