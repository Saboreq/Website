import { createClient } from 'npm:@supabase/supabase-js@2';

const configuredOrigin = (Deno.env.get('ALLOWED_ORIGIN') ?? '').replace(/\/+$/, '');
const corsBaseHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};
const responseSecurityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function normalizedRequestOrigin(request: Request) {
  return (request.headers.get('Origin') ?? '').replace(/\/+$/, '');
}

function isLocalOrigin(origin: string) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function isAllowedOrigin(request: Request) {
  const origin = normalizedRequestOrigin(request);
  if (!origin) return true;
  return isLocalOrigin(origin) || (Boolean(configuredOrigin) && origin === configuredOrigin);
}

function corsHeaders(request: Request) {
  const origin = normalizedRequestOrigin(request);
  const allowedOrigin = isLocalOrigin(origin) ? origin : origin === configuredOrigin ? configuredOrigin : '';
  return {
    ...corsBaseHeaders,
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {})
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      ...responseSecurityHeaders,
      'Content-Type': 'application/json'
    }
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value.toUpperCase().trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (!isAllowedOrigin(request)) {
    return new Response(JSON.stringify({ ok: false, error: 'Origin not allowed.' }), {
      status: 403,
      headers: { ...responseSecurityHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders(request), ...responseSecurityHeaders } });
  }
  if (request.method !== 'POST') return json(request, { ok: false, error: 'Method not allowed.' }, 405);

  try {
    const { email, password, inviteCode } = await request.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedCode = typeof inviteCode === 'string' ? inviteCode.trim() : '';

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 8 || password.length > 128 || normalizedCode.length < 10) {
      return json(request, { ok: false, error: 'Check the email, password, and invite code.' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new Error('The function is missing Supabase secrets.');

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const codeHash = await sha256(normalizedCode);

    const { data: invite } = await admin
      .from('invites')
      .select('id, use_count, max_uses, target_role')
      .eq('code_hash', codeHash)
      .is('disabled_at', null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .limit(1)
      .maybeSingle();

    if (!invite || invite.use_count >= invite.max_uses) {
      return json(request, { ok: false, error: 'This invite is invalid or no longer available.' }, 403);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      app_metadata: { app_role: invite.target_role }
    });
    if (createError || !created.user) return json(request, { ok: false, error: 'Could not create this account.' }, 400);

    const { data: consumed, error: consumeError } = await admin.rpc('consume_invite', {
      p_code_hash: codeHash,
      p_user_id: created.user.id
    });

    if (consumeError || consumed !== invite.target_role) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json(request, { ok: false, error: 'This invite is invalid or no longer available.' }, 403);
    }

    return json(request, { ok: true, role: consumed }, 201);
  } catch (error) {
    console.error('register-with-invite failed', error instanceof Error ? error.message : error);
    return json(request, { ok: false, error: 'Registration is temporarily unavailable.' }, 500);
  }
});
