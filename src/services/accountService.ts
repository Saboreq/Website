import { supabase } from '../lib/supabase';
import type { AppRole, CreatedInvite, InviteRecord, ProfileRecord } from '../types';

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function fetchProfile(userId: string): Promise<ProfileRecord> {
  const { data, error } = await client().from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data as ProfileRecord;
}

export async function fetchMembers(): Promise<ProfileRecord[]> {
  const { data, error } = await client().from('profiles').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProfileRecord[];
}

export async function fetchInvites(): Promise<InviteRecord[]> {
  const { data, error } = await client().from('invites').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InviteRecord[];
}

export async function createInvite(input: {
  label: string;
  maxUses: number;
  expiresAt: string | null;
  targetRole: Exclude<AppRole, 'owner'>;
}): Promise<CreatedInvite> {
  const { data, error } = await client().rpc('create_role_invite', {
    p_label: input.label,
    p_max_uses: input.maxUses,
    p_expires_at: input.expiresAt,
    p_target_role: input.targetRole
  });
  if (error) throw error;
  const created = Array.isArray(data) ? data[0] : data;
  if (!created?.code) throw new Error('The invite was created without a return code.');
  return created as CreatedInvite;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await client().rpc('revoke_invite', { p_invite_id: inviteId });
  if (error) throw error;
}

export async function setMemberRole(userId: string, role: Exclude<AppRole, 'owner'>): Promise<ProfileRecord> {
  const { data, error } = await client().rpc('set_member_role', { p_user_id: userId, p_role: role });
  if (error) throw error;
  return data as ProfileRecord;
}
