# Changelog

## 1.1.0 — 2026-10-10

**Install without cloning or building**

- **Prebuilt image** for linux/amd64 and linux/arm64 at
  `ghcr.io/tillheidrich/klarbild`. The compose files pull `:1`, which follows every
  1.x release; an update is `docker compose pull && docker compose up -d`. The quick
  start needs two downloaded files instead of a clone and a build.
- The image is two-stage: no compiler, no dev dependencies, no source tree at runtime.
  It **runs as uid 1000**, not root.

**First visit**

- On a print-only instance the print studio no longer offers "Pick from the library" —
  the library belongs to the AI module, and on an instance without it the button
  opened an empty picker. In its place: **Try it with a sample photo**, an original
  illustration that goes through the normal upload.
- A favicon and an iPhone home-screen icon.

**Trash (AI module)**

- Deleting moves an image into the **trash** instead of removing it on the spot. It is
  hidden from the library, share links, ZIPs, deliveries, the mirror, print sources and
  the print history, and comes back unchanged on restore. "Undo" in the toast, a trash
  view with days left, restore, delete for good, empty.
- Maintenance purges after `trash_days` (default 30, Admin → Storage & cleanup). 0
  switches the trash off.
- An image trashed while queued is skipped instead of being generated and billed.
- Purging removes only files no other image still uses: alternatives share their source
  with the original.
- API: `DELETE /api/items/:id` now trashes (`?purge=1` for good), `GET|POST|DELETE
  /api/trash`. See `/llms.txt`.

**Fixed**

- Only the file route checked who may see an image. Rename, delete, retry, alternative,
  reuse and the selection ZIP accepted any id from any signed-in account. One rule now
  (`src/lib/itemaccess.ts`): read your own, or a shared library but never a private
  session; change only your own; admins everything. A refused id answers 404.
- README said Astro 5; it is Astro 7.

**Dependencies**

- nodemailer 10, basic-ftp 6, argon2 0.45, archiver 8, ssh2-sftp-client 12,
  @astrojs/react 7, Astro 7.3.8, sharp 0.35.5 — `npm audit` 0 (was 7, six high).
- Node ≥ 22.12.
- Not taken yet: pg-boss 12 (it cannot migrate the v10 queue schema in place) and
  TypeScript 7.

**Upgrading from 1.0**

- If you built 1.0 yourself with the old compose file, your files volume belongs to
  root. The new image runs as uid 1000, so hand the volume over once:
  `docker compose run --rm --user root app chown -R 1000:1000 /data`
- basic-ftp 6 no longer silently redirects the data connection when an FTP server
  behind NAT announces its private address. If a delivery target that worked fails
  now, "Test connection" names the cause.

## 1.0.0 — first public release

The first open-source release of Klarbild. Everything before this lived in a
private repository as a personal tool.

**New in the public version**

- **Optional modules.** `KLARBILD_MODULES` decides what an instance is. The
  default is the print studio alone — no image model, no object store, no bot
  token, no account anywhere. See `src/lib/modules.ts`.
- **English interface**, with German as a full second language. The English
  sentence is the translation key; 1,067 entries, covering every translatable
  string in the source.
- **First-run setup.** No built-in accounts. The first boot creates one
  administrator from `ADMIN_USERNAME` / `ADMIN_PASSWORD`, or generates a password
  and prints it once to the log.
- **Two compose files.** `docker-compose.yaml` is the print-only stack (app plus
  Postgres, files on a volume); `docker-compose.full.yaml` adds MinIO and every
  module.
- **Delivery is generic.** The delivery and backup targets are plain SFTP/FTPS
  endpoints you configure, switched off by default.
- English routes: `/print`, `/library`, `/queue`, `/shares`, `/help`, `/account`,
  `/tour`, `/password`.
- AGPL-3.0, CI (build, tests, type check, secret scan), `CONTRIBUTING`, `SECURITY`.
- Astro 7 and current `sharp`: `npm audit` reports no known vulnerability.

**Carried over from the private tool**

The print engine as it stands: 86 image sizes in 10 groups, 19 paper formats
including A3+ and photo paper, corner marks and continuous lines, bleed 0–10 mm,
crop or letterbox per picture, oversize as fit / overflow / tile with glue flaps
and page numbers, captions in six positions, duplicate cells, presets, and a run
history that stores the instructions rather than the PDF. Plus the optional
modules: image generation, delivery, backup mirror, share links, mail, Telegram,
and an MCP server for assistants.
