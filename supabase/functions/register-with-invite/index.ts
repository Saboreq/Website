import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value.toUpperCase().trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  try {
    const { email, password, inviteCode } = await request.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedCode = typeof inviteCode === 'string' ? inviteCode.trim() : '';

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 8 || password.length > 128 || normalizedCode.length < 10) {
      return json({ ok: false, error: 'Check the email, password, and invite code.' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new Error('The function is missing Supabase secrets.');

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const codeHash = await sha256(normalizedCode);

    const { data: invite } = await admin
      .from('invites')
      .select('id, use_count, max_uses')
      .eq('code_hash', codeHash)
      .is('disabled_at', null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .limit(1)
      .maybeSingle();

    if (!invite || invite.use_count >= invite.max_uses) {
      return json({ ok: false, error: 'This invite is invalid or no longer available.' }, 403);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true
    });
    if (createError || !created.user) return json({ ok: false, error: 'Could not create this account.' }, 400);

    const { data: consumed, error: consumeError } = await admin.rpc('consume_invite', {
      p_code_hash: codeHash,
      p_user_id: created.user.id
    });

    if (consumeError || consumed !== true) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ ok: false, error: 'This invite is invalid or no longer available.' }, 403);
    }

    return json({ ok: true }, 201);
  } catch (error) {
    console.error('register-with-invite failed', error instanceof Error ? error.message : error);
    return json({ ok: false, error: 'Registration is temporarily unavailable.' }, 500);
  }
});
