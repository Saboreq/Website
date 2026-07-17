# Filehaven — Portfolio Copy

## Project card

**Filehaven** is a secure, invite-only file sharing platform that separates public downloads from owner-only private storage. It combines a polished React interface with Supabase Auth, Postgres row-level security, private object storage, short-lived download links, and server-validated invite registration.

## Short summary

I designed and developed Filehaven as a modern alternative to a repository-backed download page. Files now live in Supabase Storage while Postgres tracks virtual folders, ownership, visibility, and file metadata. Visitors can browse public content without an account; members can upload, organize, replace, and delete their own files, while private items remain invisible to every other account.

## Case-study summary

The original website depended on files committed directly into project folders, which coupled content management to source deployments and offered no account-level privacy. I rebuilt it as a storage-backed web application with explicit security boundaries.

The frontend is a responsive React and TypeScript interface with searchable and sortable folders, public/private upload controls, owner action menus, replacement and deletion confirmations, invite-only authentication, and a restrained cyber-neon visual system. The backend uses Supabase Auth, Postgres, Storage, and an Edge Function. Row-level security protects both metadata and stored objects, so privacy is enforced by the data layer rather than hidden only in the UI. Downloads use signed URLs that expire after 60 seconds, and invite codes are normalized, hashed, usage-limited, and consumed server-side.

## Core features

- Anonymous browsing and downloading of public files and folders
- Invite-only email/password registration and member sign-in
- Member-only uploads and virtual folder creation
- Public or owner-only privacy chosen at creation time
- Strict account isolation for private content
- Owner-only file replacement that preserves the logical filename and URL path
- Owner-only permanent file deletion with confirmation
- Search, sorting, breadcrumbs, responsive layouts, and accessible interaction states
- Private Storage bucket with short-lived signed downloads

## Security and architecture

- React 19, TypeScript, and Vite 7 frontend deployed as a static Vercel app
- Supabase Auth for member sessions
- Postgres for metadata, virtual folders, ownership, and invite records
- Supabase Storage for file objects
- Row-level security on database rows and Storage objects
- Supabase Edge Function for service-role invite validation
- Environment-based configuration with no privileged secret exposed to the browser

## My role

Product direction, information architecture, UI/UX design, responsive frontend implementation, Supabase data modeling, authentication and invite flow, Storage integration, RLS policy design, file lifecycle controls, deployment documentation, and quality assurance.

## Suggested tags

React · TypeScript · Vite · Supabase · PostgreSQL · Row-Level Security · Authentication · File Storage · Vercel · Responsive Web Design
