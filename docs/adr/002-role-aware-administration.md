# ADR 002: Role-aware administration

Status: accepted — 2026-07-17

## Context

Filehaven needs folder rename/deletion and an administration dashboard without weakening its defining privacy boundary. Regular members must never see or manage another member's private folders. Public folder structure needs controlled moderation, and invite creation must distinguish normal members from administrators.

## Decision

Add a `profiles` table with exactly three application roles: `owner`, `admin`, and `user`. The oldest existing Auth account becomes the single bootstrap owner; new accounts default to `user` unless a server-validated invite assigns `admin`.

Postgres remains authoritative:

- Private folders are readable and mutable only by their real owner, regardless of an operator's application role.
- Public folders can be created, renamed, and deleted only by `owner` or `admin` accounts.
- The owner can view members, promote or demote non-owner members, and create `user` or `admin` invites.
- Admins can create and revoke only their own `user` invites.
- Invite plaintext is returned once at creation; only a SHA-256 hash is stored.

Folder rename uses column-scoped Postgres grants and RLS. Recursive folder deletion runs through a narrow Edge Function: it verifies the caller, obtains a service-only deletion manifest, removes Storage objects, and then deletes the folder metadata. This avoids orphaning uploaded objects while keeping the service key out of the browser.

## Alternatives considered

1. Store the role only in JWT app metadata. Rejected because role changes remain stale until token refresh and database policies would depend on cached claims.
2. Let admins inspect all private content. Rejected because administration should not override owner-only private storage.
3. Allow direct browser folder deletion through RLS. Rejected because cascading metadata deletion would leave the actual Storage objects behind.
4. Store reusable invite plaintext for later copying. Rejected because a database read would expose every active registration credential.

## Consequences

- Role checks incur small indexed profile lookups through `security definer` helpers.
- The first production migration must verify that the oldest Auth account is the intended owner.
- Created invite codes must be copied when shown; they cannot be recovered later.
- Deleting a folder is intentionally all-or-nothing from the UI and removes descendant files and folders.

