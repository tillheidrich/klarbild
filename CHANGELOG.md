# Changelog

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
