# SabHaven — Portfolio Copy

## Project card

**SabHaven** is a privacy-focused, invite-only file platform that separates public downloads from owner-only private storage. It combines a polished React interface with Supabase Auth, Postgres row-level security, a private object bucket, short-lived download links, server-validated invite registration, and role-aware administration.

## Short summary

I designed and developed SabHaven as a modern replacement for a repository-backed download page. Files live in Supabase Storage while Postgres tracks virtual folders, ownership, visibility, roles, and file metadata. Visitors can browse public content without an account; members can upload, organize, replace, and delete their own files, while private items remain invisible to every other account.

## Case-study summary

The original website depended on files committed directly into project folders, which coupled content management to source deployments and offered no account-level privacy. I rebuilt it as a storage-backed web application with explicit authorization boundaries.

The frontend is a responsive React and TypeScript interface with searchable and sortable folders, public/private upload controls, owner action menus, replacement and deletion confirmations, invite-only authentication, and a focused administration dashboard. The backend uses Supabase Auth, Postgres, Storage, and narrow Edge Functions. Row-level security protects both metadata and stored objects, so access is enforced by the data layer rather than hidden only in the UI.

Folder authorization evaluates the complete ancestry chain. Downloads use signed URLs that expire after 60 seconds. Invite codes are normalized, hashed, usage-limited, and consumed server-side. Storage uploads require matching owner-controlled metadata, reducing the risk of authenticated users creating untracked objects.

## Core features

- Anonymous browsing and downloading of public files and folders
- Invite-only email/password registration and member sign-in
- Member-only uploads and virtual folder creation
- Public or owner-only privacy selected at creation time
- Strict account isolation across complete private folder trees
- Owner-only file replacement that preserves the logical filename and path
- Owner-only permanent file deletion with confirmation
- Owner/admin dashboard for members, roles, and scoped invitations
- Search, sorting, breadcrumbs, responsive layouts, and accessible interaction states
- Private Storage bucket with short-lived signed downloads

## Security and architecture

- React 19, TypeScript, and Vite frontend deployed as a static Vercel application
- Supabase Auth for member sessions
- Postgres for metadata, virtual folders, ownership, roles, and invite records
- Supabase Storage for private object storage
- Row-level security on database rows and Storage objects
- Edge Functions for service-role invite validation and recursive folder deletion
- Exact production-origin handling for browser function requests
- Environment-based configuration with no privileged secret exposed to the browser
- Automated source-level security model tests for policies, roles, and Edge Function boundaries

## Security scope

SabHaven is privacy-focused but is not an end-to-end encrypted or independently audited storage product. It currently does not include malware scanning, per-user quotas, a complete audit UI, or distributed registration rate limiting. Those limitations are documented in `SECURITY.md` and should be addressed before opening the platform beyond a trusted group.

## My role

Product direction, information architecture, UI/UX design, responsive frontend implementation, Supabase data modeling, authentication and invite flow, Storage integration, RLS policy design, role administration, file lifecycle controls, deployment documentation, security review, and quality assurance.

## Suggested tags

React · TypeScript · Vite · Supabase · PostgreSQL · Row-Level Security · Authentication · File Storage · Edge Functions · Vercel · Responsive Web Design
