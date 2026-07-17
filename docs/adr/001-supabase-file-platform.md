# ADR 001: Supabase-backed file platform

Status: accepted — 2026-07-17

## Context

The previous site committed downloadable binaries to the repository and copied them into `public/files` during every build. The replacement needs public downloads, owner-only private items, authenticated uploads/folder creation, and invite-only registration while remaining inexpensive and simple to operate.

## Decision

Keep React/Vite on Vercel and use one Supabase project for Auth, Postgres metadata, private object Storage, and a registration Edge Function.

All objects stay in a private bucket. Postgres RLS is the authorization source of truth for metadata and object reads. Anonymous users may select public items whose ancestor folders are public. Authenticated owners may select their own private items. Downloads use 60-second signed URLs.

Invite registration runs in an Edge Function holding the service-role credential. Direct Auth sign-up must be disabled. Invite codes are stored only as hashes and consumed with a locked database update to prevent overuse.

## Alternatives considered

1. **Cloudflare R2 plus a custom API/database** — better egress economics at higher volume, but adds a backend, separate identity system, and more policy code. Revisit if download egress becomes the dominant cost.
2. **Firebase Auth/Firestore/Storage** — viable managed stack, but folder/ancestor authorization and relational invite accounting are clearer in Postgres RLS.
3. **Two Supabase buckets (public/private)** — simpler public URLs, but changing visibility requires object moves and a public bucket bypasses download RLS. Rejected for weaker and more error-prone privacy transitions.
4. **Repository or release assets** — cheap for immutable public downloads, but cannot safely support private files or authenticated browser uploads.

## Boundaries and failure handling

- Browser: publishable key only; untrusted and never authoritative.
- Postgres/Storage: RLS denies by default and verifies user ownership/visibility.
- Edge Function: service-role key stays server-side; returns generic invite failures.
- Upload: metadata reservation is deleted if Storage upload fails.
- Registration: a newly created Auth user is deleted if atomic invite consumption loses a race.
- Legacy data migration: manual after credentials and quota are confirmed.

## Revisit triggers

- Move storage to R2 or another object host if Supabase egress/storage pricing becomes material.
- Add resumable uploads when larger files or unreliable networks make standard uploads brittle.
- Add moderation, antivirus scanning, quotas, and audit UI before opening invites beyond a trusted group.
