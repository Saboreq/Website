import { useState, type FormEvent } from 'react';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';
import { useModalFocus } from '../lib/useModalFocus';

interface AuthPanelProps {
  onClose: () => void;
}

type Mode = 'sign-in' | 'register';

export function AuthPanel({ onClose }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus<HTMLElement>(true, onClose);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setStatus('');

    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
        return;
      }

      const { data, error } = await supabase.functions.invoke('register-with-invite', {
        body: { email, password, inviteCode }
      });
      if (error) throw new Error(await describeFunctionError(error));
      if (!data?.ok) throw new Error(data?.error ?? 'Registration failed.');

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="auth-title"
        aria-modal="true"
        className="auth-panel"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button aria-label="Close authentication panel" className="icon-button close-button" onClick={onClose} type="button">
          ×
        </button>
        <p className="eyebrow">Member access</p>
        <h2 id="auth-title">{mode === 'sign-in' ? 'Welcome back' : 'Join with an invite'}</h2>
        <p className="panel-copy">
          {mode === 'sign-in'
            ? 'Sign in to upload files and create folders.'
            : 'Registration is closed unless you have a valid invite code.'}
        </p>

        <div className="segmented-control" aria-label="Authentication mode">
          <button aria-pressed={mode === 'sign-in'} onClick={() => setMode('sign-in')} type="button">
            Sign in
          </button>
          <button aria-pressed={mode === 'register'} onClick={() => setMode('register')} type="button">
            Register
          </button>
        </div>

        <form className="stack-form" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {mode === 'register' ? (
            <label>
              <span>Invite code</span>
              <input
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(event) => setInviteCode(event.target.value)}
                required
                value={inviteCode}
              />
            </label>
          ) : null}
          {status ? <p className="form-status form-status--error" role="alert">{status}</p> : null}
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </section>
    </div>
  );
}

async function describeFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsFetchError) {
    return 'Registration service is unreachable. Verify that the Edge Function is deployed and its CORS origin matches this site.';
  }

  if (error instanceof FunctionsRelayError) {
    return 'Supabase could not start the registration service. Check the Edge Function deployment logs.';
  }

  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // Fall through to the safe generic message when the response is not JSON.
    }
    return `Registration service returned HTTP ${error.context.status}.`;
  }

  return error instanceof Error ? error.message : 'Registration failed.';
}
