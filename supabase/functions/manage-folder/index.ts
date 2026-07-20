import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const corsBaseHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { ...corsBaseHeaders, 'Access-Control-Allow-Origin': localOrigin ? origin : allowedOrigin };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { ok: false, error: 'Method not allowed.' }, 405);

  try {
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization.toLowerCase().startsWith('bearer ')) {
      return json(request, { ok: false, error: 'Sign in before managing folders.' }, 401);
    }

    const { folderId } = await request.json();
    if (typeof folderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(folderId)) {
      return json(request, { ok: false, error: 'A valid folder is required.' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('The function is missing Supabase secrets.');

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: identity, error: identityError } = await caller.auth.getUser();
    if (identityError || !identity.user) {
      return json(request, { ok: false, error: 'Your session is no longer valid.' }, 401);
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: manifest, error: manifestError } = await admin.rpc('folder_deletion_manifest', {
      p_folder_id: folderId,
      p_actor_id: identity.user.id
    });
    if (manifestError) {
      const forbidden = manifestError.code === '42501';
      return json(request, { ok: false, error: forbidden ? 'You cannot delete this folder.' : 'Folder deletion could not be prepared.' }, forbidden ? 403 : 400);
    }

    const storagePaths = (manifest ?? [])
      .map((entry: { storage_path?: unknown }) => entry.storage_path)
      .filter((path: unknown): path is string => typeof path === 'string');

    for (let offset = 0; offset < storagePaths.length; offset += 100) {
      const { error: storageError } = await admin.storage
        .from('downloads')
        .remove(storagePaths.slice(offset, offset + 100));
      if (storageError) throw storageError;
    }

    const { error: deleteError, count } = await admin
      .from('folders')
      .delete({ count: 'exact' })
      .eq('id', folderId);
    if (deleteError) throw deleteError;
    if (count !== 1) return json(request, { ok: false, error: 'Folder no longer exists.' }, 404);

    return json(request, { ok: true, removedFiles: storagePaths.length });
  } catch (error) {
    console.error('manage-folder failed', error instanceof Error ? error.message : error);
    return json(request, { ok: false, error: 'Folder deletion is temporarily unavailable.' }, 500);
  }
});
