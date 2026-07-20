# Filehaven

Filehaven is an invite-only file portal built with React, Vite, and Supabase. Anyone can browse and download public items. Signed-in members can upload files, create private folders, replace their existing uploads, and remove their own content. Owner/admin accounts manage the public folder structure and invitation dashboard. Private items remain visible only to their actual owner—including from admins.

## Access model

| Account | Public files/folders | Own private items | Other private items | Folder controls | Dashboard |
| --- | --- | --- | --- | --- | --- |
| Anonymous | Read/download | No | No | None | No |
| User | Read/download | Read/manage | No | Own private folders only | No |
| Admin | Read/download | Read/manage | No | Public folders + own private folders | User invites only |
| Owner | Read/download | Read/manage | No | Public folders + own private folders | Members + user/admin invites |

These rules are enforced by Postgres and Storage row-level security (RLS), not only by the React interface. A public child inside a private parent remains private to the parent owner.

## Architecture

- **Vercel** serves the static React app.
- **Supabase Auth** signs members in with email/password.
- **Postgres** stores virtual folders, file metadata, visibility, ownership, update timestamps, and hashed invite codes.
- **Supabase Storage** stores objects in one private `downloads` bucket.
- **RLS policies** expose public metadata to everyone and private metadata only to its owner. Storage follows the same policy before issuing a download.
- **Signed URLs** expire after 60 seconds.
- **`register-with-invite` Edge Function** validates and consumes invite codes with the service role. The service-role key never reaches the browser.
- **`manage-folder` Edge Function** removes descendant Storage objects before cascading folder metadata deletion.
- **Postgres profiles and role RPCs** keep owner/admin/user authority server-side. Invite plaintext is returned once and never stored.

See [ADR 001](docs/adr/001-supabase-file-platform.md) for the storage architecture and [ADR 002](docs/adr/002-role-aware-administration.md) for role boundaries. A portfolio-ready project description is available in [docs/PORTFOLIO_SUMMARY.md](docs/PORTFOLIO_SUMMARY.md).

## Local setup

1. Create a Supabase project, install the Supabase CLI, and link it:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

2. Apply all migrations and deploy the Edge Functions:

   ```powershell
   npx supabase db push
   npx supabase functions deploy register-with-invite --no-verify-jwt
   npx supabase functions deploy manage-folder --no-verify-jwt
   ```

   Database migrations and Edge Functions are separate from a Vercel deployment. Adding environment variables to Vercel does not perform either command.

3. In **Supabase Dashboard → Authentication → Sign In / Providers**, disable **Allow new users to sign up**. Existing users can still sign in, while registration remains available through the invite function only.

4. Allow the exact production browser origin:

   ```powershell
   npx supabase secrets set ALLOWED_ORIGIN=https://your-site.example
   ```

5. Copy `.env.example` to `.env.local` and set the project URL and **publishable** key. Never put a secret/service-role key in a `VITE_` variable.

6. Install and run:

   ```powershell
   npm install
   npm run dev
   ```

## Bootstrap owner and create invites

The role migration promotes the oldest existing Auth account to the single `owner` role. Verify that this is the intended account after the first migration.

Afterward, the owner creates `user` or `admin` invites from `/dashboard`. Admins can access the same dashboard but can create only `user` invites. The generated code is displayed once; copy it before leaving the creation result.

For the very first account on a new installation, generate a long random code and run this legacy bootstrap helper in the Supabase SQL editor. Only the SHA-256 hash is stored.

```sql
select public.create_invite(
  p_code := 'REPLACE-WITH-A-LONG-RANDOM-CODE',
  p_label := 'Initial member',
  p_max_uses := 1,
  p_expires_at := now() + interval '7 days'
);
```

Send the original code privately; it cannot be recovered from the database.

## Deploy to Vercel

Set these Vercel environment variables for Production and Preview, then redeploy:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_MAX_UPLOAD_BYTES` (optional; defaults to 50 MiB)

`vercel.json` already routes virtual folder URLs to the single-page app.

## File lifecycle

- Uploads reserve metadata before the object is stored; a failed upload removes the reservation.
- Replace updates the existing Storage object and refreshes its size, MIME type, and `updated_at` value. Its displayed name, path, folder, owner, and visibility do not change.
- Delete removes both the stored object and its metadata listing. Only the owner has permission for either operation.
- Folder rename is column-scoped: private folders are owner-managed, while public folders require an owner/admin role.
- Folder delete recursively removes stored descendants through the authenticated `manage-folder` function before deleting metadata.
- The repository no longer contains or serves legacy binary files. All downloadable content comes from Supabase Storage.

## Quality commands

```powershell
npm run typecheck
npm test
npm run build
```

## Security notes

- The bucket is private even for public files. Every download is authorized before a short-lived URL is issued.
- Private metadata queries return only the signed-in user's own items; other members' private rows are filtered out by RLS.
- Admin and owner roles do not bypass another member's private-folder boundary.
- Folder privacy applies to descendants.
- Registration checks and invite role assignment are server-side. Invites can expire, have a usage limit, or be disabled.
- Keep `ALLOWED_ORIGIN` exact in production and add rate limiting or CAPTCHA if invite registration attracts abuse.

Developed by [Saboreq](https://saboreq.xyz).
