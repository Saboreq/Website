import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Session } from '@supabase/supabase-js';
import { ArrowLeft, LayoutDashboard, LockKeyhole } from 'lucide-react';

import { AuthPanel } from './components/AuthPanel';
import { DirectoryList } from './components/DirectoryList';
import { StatusToast } from './components/StatusToast';
import { UploadPanel } from './components/UploadPanel';
import { WelcomeGate } from './components/WelcomeGate';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { fetchProfile } from './services/accountService';
import { fetchDirectory, fetchFolderChain } from './services/directoryService';
import type { DirectoryContents, FolderRecord, ProfileRecord } from './types';

const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const emptyContents: DirectoryContents = { folders: [], files: [] };
const folderIdFromUrl = () => new URLSearchParams(window.location.search).get('folder');
const routeFromUrl = () => window.location.pathname === '/dashboard' ? 'dashboard' : 'browser';
type EntryState = 'welcome' | 'leaving' | 'entered';
type Route = 'browser' | 'dashboard';
type RouteTransitionDirection = 'forward' | 'back';

let routeTransitionToken = 0;

/* pushState route swaps never trigger the CSS `navigation: auto` opt-in, so
   same-document transitions must be started here. The data attribute drives
   the direction-aware rules in view-transitions.css. */
function runRouteTransition(direction: RouteTransitionDirection, apply: () => void) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || typeof document.startViewTransition !== 'function') {
    apply();
    return;
  }
  const token = ++routeTransitionToken;
  document.documentElement.dataset.routeTransition = direction;
  const clear = () => {
    if (token === routeTransitionToken) delete document.documentElement.dataset.routeTransition;
  };
  document.startViewTransition(() => flushSync(apply)).finished.then(clear, clear);
}

export default function App() {
  const initialRoute = routeFromUrl();
  const [route, setRoute] = useState<Route>(initialRoute);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(folderIdFromUrl);
  const [folderChain, setFolderChain] = useState<FolderRecord[]>([]);
  const [contents, setContents] = useState<DirectoryContents>(emptyContents);
  const [entryState, setEntryState] = useState<EntryState>(initialRoute === 'dashboard' ? 'entered' : 'welcome');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notificationVisible, setNotificationVisible] = useState(false);
  const entryTimerRef = useRef<number | null>(null);
  const firstLoadRef = useRef(true);
  const routeRef = useRef(initialRoute);
  routeRef.current = route;

  const currentFolder = folderChain.at(-1) ?? null;
  const privileged = profile?.role === 'owner' || profile?.role === 'admin';
  const publicFolderTree = folderChain.every((folder) => !folder.is_private);
  const canUploadFiles = Boolean(session?.user && (!currentFolder || currentFolder.owner_id === session.user.id));
  const canCreateFolders = Boolean(session?.user && (
    !currentFolder
    || currentFolder.owner_id === session.user.id
    || (privileged && !currentFolder.is_private)
  ));
  const canCreatePublicFolder = Boolean(privileged && publicFolderTree);
  const canCreatePrivateFolder = Boolean(session?.user && (!currentFolder || currentFolder.owner_id === session.user.id));

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
    if (!supabase) {
      setProfileLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      setProfileError('');
      setProfileLoading(false);
      return;
    }

    let active = true;
    setProfileLoading(true);
    setProfileError('');
    void fetchProfile(session.user.id)
      .then((nextProfile) => { if (active) setProfile(nextProfile); })
      .catch((error) => {
        if (!active) return;
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : 'Account permissions could not be loaded.');
      })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [session?.user]);

  useEffect(() => {
    if (route === 'browser' && entryState === 'entered') void refresh();
  }, [entryState, refresh, route, session?.user.id]);

  useEffect(() => {
    if (route !== 'browser' || entryState === 'entered') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [entryState, route]);

  useEffect(() => () => {
    if (entryTimerRef.current !== null) window.clearTimeout(entryTimerRef.current);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const nextRoute = routeFromUrl();
      const apply = () => {
        setRoute(nextRoute);
        setCurrentFolderId(nextRoute === 'browser' ? folderIdFromUrl() : null);
        if (nextRoute === 'browser') setEntryState('entered');
      };
      if (nextRoute === routeRef.current) apply();
      else runRouteTransition(nextRoute === 'dashboard' ? 'forward' : 'back', apply);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(folder: FolderRecord | null) {
    const id = folder?.id ?? null;
    const apply = () => {
      window.history.pushState({}, '', id ? `/?folder=${encodeURIComponent(id)}` : '/');
      setRoute('browser');
      setEntryState('entered');
      setCurrentFolderId(id);
    };
    if (route === 'dashboard') runRouteTransition('back', apply);
    else apply();
  }

  function navigateDashboard() {
    if (route === 'dashboard') return;
    runRouteTransition('forward', () => {
      window.history.pushState({}, '', '/dashboard');
      setRoute('dashboard');
      setCurrentFolderId(null);
    });
  }

  function enterWorkspace() {
    if (entryState !== 'welcome') return;
    setEntryState('leaving');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    entryTimerRef.current = window.setTimeout(() => setEntryState('entered'), reducedMotion ? 0 : 460);
  }

  const visibleEmail = useMemo(() => session?.user.email ?? 'Member', [session]);
  const shellLocked = route === 'browser' && entryState !== 'entered';

  return (
    <>
      <div aria-hidden={shellLocked ? true : undefined} className={`site-shell site-shell--${entryState}`} inert={shellLocked}>
        <div className="ambient-background" aria-hidden="true"><span className="ambient-background__aurora" /><span className="ambient-background__beam" /><span className="ambient-background__grain" /></div>
        <header className="topbar">
          <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate(null); }}><span className="brand-mark" aria-hidden="true">F</span><span>Filehaven</span></a>
          <nav aria-label="Account">
            {session ? (
              <div className="account-actions">
                {route === 'dashboard' ? <button className="ghost-button nav-button" onClick={() => navigate(null)} type="button"><ArrowLeft size={14} /> Back to files</button>
                  : privileged ? <button className="ghost-button nav-button" onClick={navigateDashboard} type="button"><LayoutDashboard size={14} /> Dashboard</button> : null}
                <span className="account-email">{visibleEmail}</span>
                {route === 'dashboard' && profile ? <span className={`role-badge role-badge--${profile.role}`}>{profile.role}</span> : null}
                <button className="ghost-button" onClick={() => void supabase?.auth.signOut()} type="button">Sign out</button>
              </div>
            ) : <button className="ghost-button" disabled={!isSupabaseConfigured} onClick={() => setAuthOpen(true)} type="button">Member sign in</button>}
          </nav>
        </header>

        {route === 'dashboard' ? (
          profileLoading ? <DashboardFallback />
            : session && profile && privileged ? <Suspense fallback={<DashboardFallback />}><AdminDashboard profile={profile} user={session.user} /></Suspense>
              : <main className="access-denied"><LockKeyhole aria-hidden="true" size={26} /><p className="eyebrow">Restricted area</p><h1>Dashboard access required</h1><p>{profileError || (session ? 'This account does not have an owner or admin role.' : 'Sign in with an owner or admin account to continue.')}</p>{!session ? <button className="primary-button" onClick={() => setAuthOpen(true)} type="button">Member sign in</button> : <button className="secondary-button" onClick={() => navigate(null)} type="button">Back to files</button>}</main>
        ) : (
          <main className="workspace-main">
            {!isSupabaseConfigured ? <section className="setup-notice" aria-labelledby="setup-title"><span className="setup-notice__mark" aria-hidden="true">!</span><div><p className="eyebrow">Setup required</p><h2 id="setup-title">Connect this build to Supabase</h2><p>Copy <code>.env.example</code> to <code>.env.local</code>, add the project URL and publishable key, then apply the included migration.</p></div></section> : null}
            {profileError ? <p className="inline-alert" role="alert">Account permissions could not be loaded. Folder creation will remain private until this is resolved.</p> : null}
            <nav className="breadcrumbs" aria-label="Breadcrumb"><button onClick={() => navigate(null)} type="button">Root</button>{folderChain.map((folder) => <span key={folder.id}><span aria-hidden="true">/</span><button onClick={() => navigate(folder)} type="button">{folder.name}</button></span>)}</nav>
            <div className={canCreateFolders || canUploadFiles ? 'content-grid' : 'content-grid content-grid--single'}>
              <DirectoryList contents={contents} failed={Boolean(loadError)} loading={loading} onChanged={refresh} onOpenFolder={navigate} role={profile?.role ?? null} user={session?.user ?? null} />
              {(canCreateFolders || canUploadFiles) && session ? <UploadPanel canCreatePrivateFolder={canCreatePrivateFolder} canCreatePublicFolder={canCreatePublicFolder} canUploadFiles={canUploadFiles} currentFolderId={currentFolderId} key={currentFolderId ?? 'root'} onChanged={refresh} user={session.user} /> : null}
            </div>
            {session && currentFolder && currentFolder.owner_id !== session.user.id ? <p className="visitor-note">You are viewing another member’s public folder. Only its owner can upload files; owner/admin accounts can manage its public folder structure.</p> : null}
          </main>
        )}

        <footer><span>Filehaven</span><span className="developer-credit">Developed by <a href="https://saboreq.xyz" rel="noreferrer" target="_blank">Saboreq</a></span><span>Short-lived links · Owner-only private access</span></footer>
        {authOpen ? <AuthPanel onClose={() => setAuthOpen(false)} /> : null}
      </div>
      {route === 'browser' && entryState !== 'entered' ? <WelcomeGate leaving={entryState === 'leaving'} onEnter={enterWorkspace} /> : null}
      {route === 'browser' && notificationVisible ? <StatusToast onDismiss={() => setNotificationVisible(false)} onRetry={() => void refresh()} /> : null}
    </>
  );
}

function DashboardFallback() {
  return <main className="admin-main admin-main--loading" aria-busy="true"><div className="skeleton-block admin-title-skeleton" /><div className="admin-grid"><div className="admin-panel admin-panel--skeleton" /><div className="admin-panel admin-panel--skeleton" /></div></main>;
}
