# Security policy

SabHaven is a privacy-focused, invite-only file portal. Security reports are welcome and should be sent privately to **contact@saboreq.xyz** rather than opened as public issues.

## Supported version

Only the latest revision of the `main` branch and the currently deployed production version are supported.

## Security model

SabHaven treats the browser as untrusted. Authorization is enforced in Supabase Postgres and Storage policies, with narrow Edge Functions used only where privileged server-side operations are required.

Current controls include:

- a private Storage bucket for every object, including publicly listed downloads;
- Postgres and Storage row-level security;
- account ownership checks across the complete folder ancestry chain;
- short-lived signed download URLs;
- invite-only account creation with hashed, expiring, usage-limited invite codes;
- owner, admin, and user roles enforced by server-side database functions;
- service-role credentials restricted to Edge Functions;
- exact production-origin configuration for browser requests;
- metadata reservation before upload, with Storage inserts restricted to matching owner metadata;
- generic public authentication errors to reduce account and invite disclosure.

## Important limitations

SabHaven is not an end-to-end encrypted storage product. The hosting providers and project operators can technically access infrastructure and stored data according to their platform privileges.

The project currently does not provide:

- malware or antivirus scanning;
- content moderation;
- per-user storage quotas;
- resumable or multipart uploads;
- a complete user-facing audit log;
- built-in CAPTCHA or distributed rate limiting for invite registration;
- independent penetration-test or compliance certification.

Do not use the project for highly regulated, life-critical, or uniquely sensitive information without an independent security review and additional controls.

## Reporting a vulnerability

Include:

1. the affected route, policy, function, or component;
2. clear reproduction steps;
3. the expected and actual result;
4. potential impact;
5. any suggested mitigation.

Please avoid accessing, modifying, or deleting data that does not belong to you. Reasonable time will be taken to validate and fix a report before public disclosure.
