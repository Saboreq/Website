# ADR 002: Role-aware administration

Status: accepted — 2026-07-17

## Context

SabHaven needs folder rename and deletion and an administration dashboard without weakening its defining privacy boundary. Regular members must never see or manage another member's private folders. Public folder structure needs controlled moderation, and invite creation must distinguish normal members from administrators.

## Decision

Add a `profiles` table with exactly three application roles: `owner`, `admin`, and `user`. The oldest existing Auth account becomes the single bootstrap owner; new accounts default to `user` unless a server-validated invite assigns `admin`.

Postgres remains authoritative:

- Private folders and their descendant trees are readable and mutable only when every private ancestor belongs to the current user.
- Public folders in a fully public tree can be created, renamed, and deleted only by `owner` or `admin` accounts.
- A public descendant inside a private tree remains controlled by that private tree's owner rather than by unrelated administrators.
- The owner can view members, promote or demote non-owner members, and create `user` or `admin` invites.
- Admins can create and revoke only their own `user` invites.
- Invite plaintext is returned once at creation; only a SHA-256 hash is stored.

Folder rename uses column-scoped Postgres grants and RLS. Recursive folder deletion runs through a narrow Edge Function: it verifies the caller, asks Postgres for an authorized deletion manifest, removes Storage objects, and then deletes folder metadata. This avoids orphaning uploaded objects while keeping the service key out of the browser.

## Alternatives considered

1. Store the role only in JWT app metadata. Rejected because role changes remain stale until token refresh and database policies would depend on cached claims.
2. Let admins inspect all private content. Rejected because administration should not override owner-only private storage.
3. Allow direct browser folder deletion through RLS. Rejected because cascading metadata deletion would leave the actual Storage objects behind.
4. Store reusable invite plaintext for later copying. Rejected because a database read would expose every active registration credential.

## Consequences

- Role and ancestry checks incur small indexed profile and recursive folder lookups.
- The first production migration must verify that the oldest Auth account is the intended owner.
- Created invite codes must be copied when shown; they cannot be recovered later.
- Deleting a folder is intentionally all-or-nothing from the UI and removes descendant files and folders.
- Any future sharing feature must be designed explicitly; it cannot be approximated by weakening owner or ancestor checks.
