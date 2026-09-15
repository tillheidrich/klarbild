# Security

## Reporting a vulnerability

Please do **not** open a public issue. Mail **mail@tillheidrich.de** with
what you found and how to reproduce it. You will get an acknowledgement within a
few days. There is no bounty programme — this is a one-person project — but
credit in the release notes is yours if you want it.

## What Klarbild already does

- Passwords are hashed with argon2. Stored credentials (SMTP, delivery targets,
  API keys) are encrypted with AES-256-GCM using `ENCRYPTION_KEY`, never written
  in plain text.
- Sessions are a signed cookie **plus** a server-side check. Changing a password
  or a role invalidates every open session; the role comes from the database, not
  from the cookie.
- Content-Security-Policy with per-script hashes rather than `'unsafe-inline'`,
  set at build time. `style-src` keeps `'unsafe-inline'` because React writes
  styles as element attributes, which cannot be hashed — a narrower class of
  problem than script injection, which stays closed.
- Remote paths are validated immediately before writing, not somewhere upstream:
  `posixpath.join('/customers/acme', '../../../etc/cron.d')` is `/etc/cron.d`, and
  the upload would have created the directory first. See `safeSegment` in
  `src/lib/remotetarget.ts` and its tests.
- Share links: expiry, revocation, optional argon2 passphrase with a rate limit,
  `noindex`, and access bound to the link rather than to the image. Visit logging
  hashes the IP with a server secret and the link id, keeps one row per visitor
  per hour, and deletes after 90 days.
- A module that is switched off returns 404, not 403.

## What it does not do

- There is no multi-tenant isolation. Every account on an instance is on the same
  instance; roles are `user` and `admin` and that is the whole model.
- Klarbild expects to run behind a reverse proxy that terminates TLS. It does not
  do TLS itself.
- `ENCRYPTION_KEY` has no rotation path yet. Losing it means re-entering the
  stored credentials.

## Supported versions

The latest release. There is no long-term support branch.
