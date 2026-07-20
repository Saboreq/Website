# Security review — July 2026

## Scope

This review covered the public React client, Supabase database migrations, Storage policies, role-management functions, invite registration, recursive folder deletion, and the repository's security documentation.

## Findings addressed

### 1. Mixed-owner private ancestry could be evaluated too loosely

The original folder access helper combined "owns any ancestor" with "all ancestors are public." In a legacy or malformed mixed-owner tree, ownership of one ancestor could make another user's private descendant visible.

**Resolution:** folder access now requires the current user to own every private folder in the complete ancestry chain. Folder management and recursive deletion use the same ancestry-aware boundary.

### 2. Authenticated accounts could create untracked Storage objects

The previous Storage insert policy checked only that an object path began with the authenticated user's ID. A signed-in account could bypass the application and upload objects without matching file metadata, consuming storage while leaving no application record.

**Resolution:** Storage inserts now require an existing `public.files` row with the exact storage path and authenticated owner. The application already reserves metadata before uploading and removes the reservation after a failed upload.

### 3. Browser function origins defaulted to a wildcard

The Edge Functions previously used `*` when `ALLOWED_ORIGIN` was absent.

**Resolution:** browser requests now allow only an exact configured production origin or local development origins. Responses also use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## Existing controls confirmed in source

- Private Supabase Storage bucket
- Postgres and Storage RLS
- 60-second signed download URLs
- Hashed, expiring, usage-limited invite codes
- Atomic invite consumption with account cleanup after a race
- Service-role keys restricted to Edge Functions
- Authenticated caller verification before privileged folder deletion
- Owner/admin/user hierarchy enforced in database functions
- Column-scoped folder rename and file metadata update grants

## Remaining limitations

The review was source-based and was not an independent penetration test. The project still lacks malware scanning, per-user quotas, a complete audit interface, distributed rate limiting, end-to-end encryption, and formal compliance certification. These limitations are documented in `SECURITY.md`.
