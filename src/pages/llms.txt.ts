import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Machine- and AI-readable short documentation at /llms.txt (public, no secrets).
 * Describes the purpose, the capabilities and the HTTP/MCP interface of Klarbild,
 * so that an AI agent can operate the tool without the web interface.
 */
const BODY = `# Klarbild

> Self-hosted image tool: turns screenshots and finds into clean, print-ready
> images (clean up, cut out, exact photo sizes, The-Frame landscape, stickers
> with a contour), delivers them to a remote target (SFTP/FTPS) and mirrors them
> to any backup target. On top of that a print module without AI (/print): bring
> images to exact physical sizes and place several of them at 100% with crop
> marks on a print sheet (PDF).
> Operated from the web, a Telegram bot and the HTTP API/MCP.

Base URL: https://klarbild.example.com
Public tour of the print module (no sign-in, description only): /tour
Public share links: /s/<slug> (no sign-in, only what the link releases)
Interface language: English; a German translation ships with it.
Stack: Astro 5 (SSR) · Postgres · sharp · pg-boss.

## Optional modules
Only the print studio is always on. Everything that needs an outside account is a
module switched on with \`KLARBILD_MODULES\` (comma separated, or \`all\`):
\`ai\`, \`delivery\`, \`mirror\`, \`share\`, \`mail\`, \`telegram\`.
Routes belonging to a module that is off answer **404** with
\`{ "error": "Module \\"<id>\\" is not enabled on this instance." }\` — to the outside
world such a module does not exist.

## Authentication (for agents)
- Header: \`Authorization: Bearer <API token>\` (Admin → "Automation / MCP access").
- The token is valid for \`/api/*\` — NOT for \`/api/admin/*\` (sign-in session only).
- Without a token or session, API routes answer 401.

## Core terms
- Mode (mode): \`each\` (clean up / cut out / format a screenshot),
  \`compose\` (convert one image OR combine several, with a text description),
  \`generate\` (a new image from text alone).
- Tasks (tasks, only with each): \`clean\`, \`cutout\`, \`format\`, \`contour\`.
- Preset recipe (recipe): a stored set of settings. Job (job): one batch; item (item): one image.
- Job status: queued, running, paused, done, failed, cancelled. \`failed\` = every item failed.

## Formats (output_format)
- Fixed keys: 9x13,10x15,13x18,15x20,20x30,30x40,30x45,40x50,40x60,50x70,60x90,
  A4,A3,A2,20x20,30x30, theframe (3840x2160), portrait916 (2160x3840), keep (keep the original).
- Custom sizes without a preset: \`WIDTHxHEIGHT\` in cm (e.g. \`25x35\`) or \`sticker<N>\`
  for N×N cm (e.g. \`sticker5\` = 5×5 cm). Limit 300 cm. Exact pixels: round(cm/2.54*dpi).
- File format (output_ext): \`png\` (lossless, transparency) or \`jpg\` (small, easy on the
  delivery target). JPG only without transparency; cut-out motifs always stay PNG.
  Global (admin) or per preset recipe.

## HTTP API (a selection, JSON)
- GET  /api/health — status (public).
- GET  /api/me — the current user and their rights.
- GET  /api/models — available image models (quality levels).
- GET  /api/recipes — list preset recipes.
- POST /api/recipes — create a preset recipe. Body among others: name, mode, tasks[], output_format,
  orientation(portrait|landscape), crop_mode(crop|extend), dpi, contour_mm, output_ext(png|jpg|null),
  delivery(library|remote|both), delivery_folder, delivery_target_id.
- DELETE /api/recipes/:id — delete a preset recipe.
- GET  /api/delivery-targets — delivery and backup targets.
- POST /api/jobs — start a job. Body: { recipe, mode, delivery, private,
  prompt_text?(compose/generate), sources:[{source_path, filename}] }. Response: { jobId }.
- GET  /api/jobs — the most recent jobs. GET /api/jobs/:id — job plus items (incl. error_message, finished_at).
- POST /api/jobs/:id/{pause|resume|cancel|retry-failed|delete}.
- POST /api/items/:id/{retry|reuse|alternative}.
- GET  /api/items/:id/file — the result image. Query: ?thumb=1 (preview), ?preview=1 (small JPG for full screen),
  ?download=1 (as a file), ?src=1 (the source). The content type is taken from the magic bytes (PNG/JPG/WEBP).

## Printing — exact sizes and print sheets (no AI, /print)
Purely local geometry: cropping (sharp) plus PDF (pdf-lib). No model, no cost.
- Size notation: \`12x15\` = 12×15 cm · \`35x45mm\` · \`5\` = 5×5 cm · \`4:3/15\` = ratio 4:3, longer edge 15 cm.
- Paper sizes (id): A6,A5,A4,A3,A3plus(329×483 mm),A2, F9x13,F10x15,F13x18,F15x20,F20x30, Letter, Legal — or a custom size.
- Image sizes: 86 presets in 10 groups (passport photo, small, photo, inch (US), instant photo,
  poster and frame, square, DIN, cards, aspect ratio) — or a custom size. The ids:
  P35x45 (biometric), P50x50 · K20x30,K30x40,K40x50,K45x60,K60x80,K60x90 ·
  S9x13,S10x15,S11x15,S12x15,S13x18,S15x20,S18x24,S20x25,S20x30,S24x30 ·
  R30x40,R30x45,R40x50,R40x60,R50x70,R60x80,R60x90,R70x100 (poster and frame) ·
  Q10x10,Q13x13,Q20x20,Q30x30 · DA6,DA5,DA4,DA3,DA2 ·
  W16x9,W9x16,W3x2,W4x3,W5x4 (aspect ratios as a print size, The Frame among them).
  So every format the AI generation offers (src/lib/format.ts) can be printed here too.
- If the image does not match the size (fit, per cell): \`cover\` = crop until it is filled (the default,
  nothing stays empty, something is lost at the edges) or \`contain\` = letterbox the whole image, the
  letterbox colour \`bg\` (#rrggbb, default #ffffff) stays around it. Nothing is ever distorted.
- Crop marks (marks.mode): \`none\` · \`corner\` (corner marks outside the trimmed size, 4 mm long by
  default, 3 mm offset, 0.25 pt hairline) · \`grid\` (continuous lines across the sheet, never running
  through a motif).
- Bleed (bleedMm): the image extends beyond each edge; the trim box stays exactly the chosen crop.
  The gap between two images is always ≥ 2 × bleed.
- Placement: images of equal size → an exact grid; mixed sizes → a MaxRects packer with a fixed
  orientation per size (it tries every combination of orientations and takes the one using the fewest sheets).
- The PDF page has exactly the sheet size. When printing choose "Actual size / 100%" — not "fit to page".
- **Larger than the sheet** (e.g. 20 × 30 cm on A4 photo paper) — per cell via \`oversize\`:
  \`fit\` = report that it does not fit (the default) · \`overflow\` = centre it on the whole sheet,
  the oversize part is cut off when printing (20 × 30 on A4: exactly 3 mm in height) ·
  \`tile\` = poster print across several sheets with a glue flap (\`overlapMm\`, default 10 mm, marked
  dashed; every sheet carries its number, row and column). 30 × 40 cm on A4 makes 2 × 2 sheets.
- **Caption** (\`footer\`): \`false\` = off · \`true\` = automatic (sizes, dpi, printing hint) ·
  \`{ text, position, sizePt }\` = your own text. Position: \`unten-links|unten-mitte|unten-rechts|
  oben-links|oben-mitte|oben-rechts\` (bottom left/centre/right, top left/centre/right). The line is
  dropped automatically when there is no free space at the chosen edge — it is never printed over an image.
- The same image may appear several times in the \`cells\` field (different \`id\`, same \`src\`), to place it
  in several sizes on one sheet. In the web interface the "Duplicate" button does that.

- POST /api/print/single — one image at an exact size. Body: { src:{kind:'upload',path}|{kind:'item',id},
  crop?:{x,y,w,h} (relative 0..1; without it a centred crop), size|wMm+hMm, landscape?, dpi?, ext?(jpg|png), bleedMm? }.
  Response: the image file. Headers: X-Klarbild-Px, X-Klarbild-Real-Dpi, X-Klarbild-Dpi-Ok.
- GET  /api/print/single?size=12x15&dpi=300 — calculation only: mm → pixels.
- POST /api/print/sheet — a print sheet as PDF. Body: { paper:{id}|{size}|{wMm,hMm}, landscape?, marginMm?,
  gapMm?, bleedMm?, center?, dpi?, ext?, footer?, marks:{mode,lengthMm?,offsetMm?},
  cells:[{ id, src, crop?, size|wMm+hMm, landscape?, count?, allowRotate?, fit?, bg?,
  oversize?(fit|overflow|tile), overlapMm? }] }.
  Response: application/pdf. Headers: X-Klarbild-Pages, X-Klarbild-Per-Sheet.
  Limits: 40 cells, 200 copies per cell, 500 individual images and 60 sheets per job.
- GET/POST/DELETE /api/print/presets — sheet presets (paper, marks, sizes, quantities).
  Example presets: "Nursery set (A4)", "Small school set (A4)", "Passport photo sheet 35×45 (A4)",
  "2 × 10×7.5 on 10×15 photo paper". A preset with several sizes and only one image clones
  that image into all of the sizes.
- Delivering a sheet: \`deliver: { target: ''|'mirror'|<uuid>, gallery? }\` in /api/print/sheet also puts
  the PDF into the target. The response is still the PDF; headers X-Klarbild-Delivered (0|1) and
  X-Klarbild-Delivery-Msg (URI encoded).

## MCP server (for assistants)
The \`klarbild\` tool (mcp/klarbild-mcp.mjs) uses the same API token:
- list_recipes — the available preset recipes.
- process_images — have images (a local folder or URLs) processed with a preset recipe.
- job_status — ask for the progress or result of a job.
- exact_size — NO AI: bring an image to an exact size and save the file locally.
- print_sheet — NO AI: save a print sheet (several images × quantity, crop marks) as a local PDF.

## Share links (public, no account)
Make an image or a collection reachable at \`/s/<slug>\` — the recipient needs no account.
- The defaults are deliberately cautious: **expiry** (default 30 days, \`settings.share_default_days\`),
  **revocable** at any time and releasable again, an optional **passphrase** (argon2),
  **downloading can be switched off**, and pages and files carry \`X-Robots-Tag: noindex\`.
- Access hangs on the **link**, not on the image: someone else's \`item\` id on a valid link
  returns 404. Images from private sessions cannot be shared at all.
- States: 200 (valid) · 401 (passphrase required or wrong) · 404 (unknown) · 410 (expired or
  revoked). The passphrase goes by **POST**, after which a short-lived cookie per link acknowledges it.
- \`GET /api/s/<slug>/file?item=<uuid>\` — the viewing take (scaled down to 2000 px).
  \`&download=1\` delivers the original; with downloading blocked, 403. \`&thumb=1\` for the overview.
- \`GET /api/s/<slug>/zip\` — **all** images of the link as a ZIP (at full resolution).
  Deliberately GET, so that it is a plain link without JavaScript. It respects the download block
  (403) and the passphrase (401). Limits: 200 files, 500 MB unpacked (after that the archive closes
  with a \`NOTE.txt\`), 5 bundles per link and address in 10 minutes. Counted as **one** download.
  One file is read and passed on after another, not everything into memory at once.
- \`GET|POST /api/shares\` — list or create your own links. Body: \`{ itemIds[], title?, note?,
  days?, allowDownload?, password? }\`. \`days\` has to be a number from 0–3650 (0 = no expiry);
  anything else is **rejected**, not read as "no expiry".
- \`GET|PATCH|DELETE /api/shares/<id>\` — view accesses, change (\`action: 'revoke'|'unrevoke'\`,
  \`title\`, \`note\`, \`days\`, \`allowDownload\`, \`password\`), delete.
- \`POST /api/shares/send\` — send a link by mail: \`{ shareId, to, message? }\`, at most 10
  recipients per request, 50 mails per hour and sender. **No attachment** — a link can be
  withdrawn, an attachment cannot.
- WhatsApp goes through a \`wa.me\` link in the browser (no server-side sending; the WhatsApp
  Business API would need a Meta account, approved templates and fees).
- What is counted is **when** and with what kind of device something was opened, not **who**:
  from the IP only a hash, salted with a server secret **and** the link id (so it cannot be
  correlated across links), at most one row per visitor and hour, deleted after 90 days.

## Email
Sending goes through your own mailbox (SMTP, credentials encrypted in \`settings\`; Admin → Email).
Needed for: resetting a password, a notice when a job is finished (switchable per user under
\`/account\`), and sending share links. Without mail configured, the routes concerned answer 503.
- \`POST /api/auth/reset { email }\` — request a reset link. Answers **always the same way**, whether
  or not the address exists. \`POST /api/auth/reset { token, password }\` — set a new password; the
  token is valid for 60 minutes, exactly once, and invalidates every open session of the account.
- \`GET|PATCH /api/me\` — your own account: \`email\`, \`notify_jobs\`.

## AI labelling
Results carry IPTC \`DigitalSourceType\` as XMP inside the file:
\`trainedAlgorithmicMedia\` (created from text) or \`compositeWithTrainedAlgorithmicMedia\`
(an existing photo changed), plus \`xmp:CreatorTool\` with the model used.
Readable with exiftool. The print module creates nothing with AI and therefore labels nothing.

## File names of the results
Scheme: \`YYYY-MM-DD_HHMMSS_<motif>_<format>_<short id>.<ext>\` — e.g. \`2026-08-20_143207_team-badge_the-frame_a3f9.jpg\`.
- The timestamp comes first, so any file listing (the delivery target, the backup mirror, a file
  manager) sorts chronologically by itself.
- The four-character short id comes from the item id. That way two images are **never** named the
  same — not even with the same motif, the same format and the same day. (Before 2026-08-21 the time
  and the short id were missing; similar images from the same day overwrote each other on delivery.)
- Time zone: \`KLARBILD_TZ\`, default \`Europe/Berlin\`.
- The motif is peeled out of the original name (dates, UUIDs and our own stamp are dropped);
  generic names such as \`IMG\`, \`photo\`, \`telegram\` become \`klarbild\`.
- Renaming the whole library: Admin → "File names", or
  \`POST /api/admin/storage { action: 'rename_preview' | 'rename_apply' | 'redeliver_all' }\` (sign-in
  session only, not with an API token). Idempotent — the stamp comes from \`created_at\`, the short id
  from the item id.

## Delivery
- A delivery target is an SFTP/FTPS server; the folder on the target is a subfolder under the base path.
  The full path is base folder + folder (only assembled when delivering). The default folder is
  "Gallery A"; "The Frame" → "TheFrame-Backgrounds".
- What is delivered is the result in the chosen file format (output_ext, global or per job) — PNG or
  JPG. Cut-out motifs stay PNG.
- An optional .md metadata sidecar file can be switched on per target (delivery target, backup mirror,
  extra target).

## Privacy
- Private session (job.private=true): no library entry, no delivery and no backup, no stored prompt;
  the result is deleted after a short while.
- Visibility is switchable globally (only your own / everyone sees everything); an admin sees everything.

Further documentation (for humans): in-app /help and /changelog.
`;

export const GET: APIRoute = async () =>
  new Response(BODY, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
