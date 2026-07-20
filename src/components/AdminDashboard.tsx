import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { Check, Clipboard, KeyRound, Search, ShieldCheck, Trash2, Users } from 'lucide-react';

import { formatDate } from '../lib/format';
import { createInvite, fetchInvites, fetchMembers, revokeInvite, setMemberRole } from '../services/accountService';
import type { AppRole, CreatedInvite, InviteRecord, ProfileRecord } from '../types';

interface AdminDashboardProps {
  profile: ProfileRecord;
  user: User;
}

export default function AdminDashboard({ profile, user }: AdminDashboardProps) {
  const [members, setMembers] = useState<ProfileRecord[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [label, setLabel] = useState('');
  const [targetRole, setTargetRole] = useState<Exclude<AppRole, 'owner'>>('user');
  const [maxUses, setMaxUses] = useState(1);
  const [expiryDays, setExpiryDays] = useState('7');
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setStatus('');
    try {
      const [nextInvites, nextMembers] = await Promise.all([
        fetchInvites(),
        profile.role === 'owner' ? fetchMembers() : Promise.resolve([])
      ]);
      setInvites(nextInvites);
      setMembers(nextMembers);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [profile.role]);

  useEffect(() => { void load(); }, [load]);

  const visibleMembers = useMemo(() => {
    const needle = memberQuery.trim().toLocaleLowerCase();
    return members.filter((member) => !needle || member.email.toLocaleLowerCase().includes(needle));
  }, [memberQuery, members]);

  const creatorEmails = useMemo(() => {
    const entries = members.map((member) => [member.id, member.email] as const);
    entries.push([profile.id, profile.email]);
    return new Map(entries);
  }, [members, profile.email, profile.id]);

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    setBusy('invite');
    setStatus('');
    setCopied(false);
    try {
      const expiresAt = expiryDays === 'never'
        ? null
        : new Date(Date.now() + Number(expiryDays) * 86_400_000).toISOString();
      const created = await createInvite({
        label,
        maxUses,
        expiresAt,
        targetRole: profile.role === 'admin' ? 'user' : targetRole
      });
      setCreatedInvite(created);
      setLabel('');
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Invite creation failed.');
    } finally {
      setBusy('');
    }
  }

  async function copyCreatedCode() {
    if (!createdInvite) return;
    await navigator.clipboard.writeText(createdInvite.code);
    setCopied(true);
  }

  async function changeRole(member: ProfileRecord, nextRole: Exclude<AppRole, 'owner'>) {
    if (member.role === nextRole) return;
    const confirmed = window.confirm(`Change ${member.email} from ${member.role} to ${nextRole}?`);
    if (!confirmed) return;
    setBusy(member.id);
    setStatus('');
    try {
      await setMemberRole(member.id, nextRole);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Role change failed.');
    } finally {
      setBusy('');
    }
  }

  async function disableInvite(invite: InviteRecord) {
    const confirmed = window.confirm(`Revoke “${invite.label}”? Anyone holding its code will lose access to registration.`);
    if (!confirmed) return;
    setBusy(invite.id);
    setStatus('');
    try {
      await revokeInvite(invite.id);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Invite revocation failed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="admin-main">
      <div className="admin-heading">
        <div><p className="eyebrow">Administration</p><h1>Control center</h1><p>Manage member access without exposing private storage.</p></div>
        <div className="role-boundary"><ShieldCheck aria-hidden="true" size={17} /><span><strong>{profile.role === 'owner' ? 'Owner controls' : 'Admin controls'}</strong>Private files remain owner-only</span></div>
      </div>

      {status ? <p className="inline-alert admin-alert" role="alert">{status}</p> : null}

      <div className={`admin-grid${profile.role === 'admin' ? ' admin-grid--admin' : ''}`}>
        {profile.role === 'owner' ? (
          <section className="admin-panel members-panel" aria-labelledby="members-title">
            <div className="admin-panel__heading"><div><p className="eyebrow">Members</p><h2 id="members-title">Accounts</h2></div><label className="search-field"><span className="sr-only">Search members</span><Search aria-hidden="true" size={14} /><input onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search members" type="search" value={memberQuery} /></label></div>
            <div className="admin-table members-table" role="table" aria-busy={loading} aria-label="Members">
              <div className="admin-row admin-row--head" role="row"><span role="columnheader">Member</span><span role="columnheader">Role</span><span role="columnheader">Joined</span></div>
              {loading ? <DashboardRows columns={3} /> : visibleMembers.map((member) => (
                <div className="admin-row" key={member.id} role="row">
                  <div className="member-cell" role="cell"><span className="member-avatar" aria-hidden="true">{member.email.slice(0, 2).toUpperCase()}</span><span><strong>{member.email}</strong>{member.id === user.id ? <small>Current account</small> : null}</span></div>
                  <div role="cell">
                    {member.role === 'owner' ? <span className="role-badge role-badge--owner">Owner</span> : (
                      <select aria-label={`Role for ${member.email}`} className="role-select" disabled={busy === member.id} onChange={(event) => void changeRole(member, event.target.value as 'user' | 'admin')} value={member.role}>
                        <option value="user">User</option><option value="admin">Admin</option>
                      </select>
                    )}
                  </div>
                  <span className="admin-date" role="cell">{formatDate(member.created_at)}</span>
                </div>
              ))}
            </div>
            <div className="admin-panel__note"><Users aria-hidden="true" size={15} />Only the owner can grant or remove administrator access.</div>
          </section>
        ) : null}

        <section className="admin-panel invite-composer" aria-labelledby="invite-title">
          <div className="admin-panel__heading"><div><p className="eyebrow">Create invite</p><h2 id="invite-title">Grant access</h2></div><KeyRound aria-hidden="true" size={19} /></div>
          <form className="invite-form" onSubmit={submitInvite}>
            <fieldset className="role-picker"><legend>Account role</legend><div className="segmented-control"><button aria-pressed={targetRole === 'user'} onClick={() => setTargetRole('user')} type="button">User</button><button aria-pressed={targetRole === 'admin'} disabled={profile.role !== 'owner'} onClick={() => setTargetRole('admin')} type="button">Admin</button></div>{profile.role === 'admin' ? <small>Admins can issue user invites only.</small> : null}</fieldset>
            <label><span>Label <small>Optional</small></span><input maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Design contractor" value={label} /></label>
            <div className="form-columns"><label><span>Max uses</span><input max={1000} min={1} onChange={(event) => setMaxUses(Number(event.target.value))} type="number" value={maxUses} /></label><label><span>Expires</span><select onChange={(event) => setExpiryDays(event.target.value)} value={expiryDays}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="never">Never</option></select></label></div>
            <button className="primary-button" disabled={busy === 'invite'} type="submit">{busy === 'invite' ? 'Generating…' : 'Generate invite'}</button>
          </form>
          {createdInvite ? <div className="created-invite" aria-live="polite"><div><span>Copy this code now</span><code>{createdInvite.code}</code><small>For security, Filehaven stores only its hash.</small></div><button aria-label="Copy invite code" className="secondary-button" onClick={() => void copyCreatedCode()} type="button">{copied ? <><Check size={14} /> Copied</> : <><Clipboard size={14} /> Copy</>}</button></div> : null}
        </section>
      </div>

      <section className="admin-panel invites-panel" aria-labelledby="invites-title">
        <div className="admin-panel__heading"><div><p className="eyebrow">Invites</p><h2 id="invites-title">Registration access</h2></div><span className="panel-count">{invites.length} total</span></div>
        <div className="admin-table invites-table" role="table" aria-busy={loading} aria-label="Invites">
          <div className="admin-row admin-row--head" role="row"><span role="columnheader">Label</span><span role="columnheader">Role</span><span role="columnheader">Uses</span><span role="columnheader">Expires</span><span role="columnheader">Created by</span><span role="columnheader">Action</span></div>
          {loading ? <DashboardRows columns={6} /> : invites.length === 0 ? <div className="admin-empty">No invites have been created yet.</div> : invites.map((invite) => {
            const inactive = Boolean(invite.disabled_at) || invite.use_count >= invite.max_uses || Boolean(invite.expires_at && Date.parse(invite.expires_at) <= Date.now());
            return (
              <div className={`admin-row${inactive ? ' admin-row--muted' : ''}`} key={invite.id} role="row">
                <div role="cell"><strong>{invite.label}</strong><small>{invite.disabled_at ? 'Revoked' : inactive ? 'Inactive' : 'Active'}</small></div>
                <span role="cell" className={`role-badge role-badge--${invite.target_role}`}>{invite.target_role}</span>
                <span role="cell">{invite.use_count} / {invite.max_uses}</span>
                <span role="cell">{invite.expires_at ? formatDate(invite.expires_at) : 'Never'}</span>
                <span className="creator-cell" role="cell">{invite.created_by ? creatorEmails.get(invite.created_by) ?? 'Admin' : 'Legacy'}</span>
                <span role="cell">{inactive ? <span className="inactive-label">Closed</span> : <button className="revoke-button" disabled={busy === invite.id} onClick={() => void disableInvite(invite)} type="button"><Trash2 size={13} /> Revoke</button>}</span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function DashboardRows({ columns }: { columns: number }) {
  return <>{[0, 1, 2].map((row) => <div className="admin-row admin-row--skeleton" key={row} role="row">{Array.from({ length: columns }, (_, column) => <span className="skeleton-block" key={column} role="cell" />)}</div>)}</>;
}
