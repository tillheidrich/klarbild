// File names for Klarbild results — deliberately **with no dependencies at all**,
// so that the rules stay testable and are the same everywhere (job processing,
// renaming, tests).
//
// Scheme: `YYYY-MM-DD_HHMMSS_<motif>_<format>_<short-id>.<ext>`
//   2026-08-20_143207_portrait-badge_the-frame_a3f9.jpg
//
// Why: the timestamp comes first, so every file listing — delivery target,
// Finder, backup mirror — sorts chronologically by itself. The name becomes
// unique through the second **and** a short id derived from the item id. Before,
// it was only `YYYY-MM-DD_<motif>_<format>`, and two badges of the same subject
// on the same day got the same name — on delivery the second overwrote the first.

/** Lower case, with hyphens, without umlaut trouble. */
export function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c] || c))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

const GENERIC = new Set(['', 'foto', 'photo', 'bild', 'image', 'img', 'telegram', 'unbenannt', 'klarbild', 'screenshot', 'pxl', 'whatsapp']);

/** A name we produced ourselves — timestamp in front, short id at the back.
 *  Needed in order to strip our own stamp again when processing further, and to
 *  recognise whether a name is already in the new scheme. */
// All the parts are slugs (a–z, 0–9, hyphen) and therefore never contain an
// underscore — so the pattern splits the name unambiguously into five parts.
export const KLARBILD_NAME =
  /^(\d{4}-\d{2}-\d{2})_(\d{6})_([a-z0-9-]+)_([a-z0-9-]+)_([0-9a-z]{4})(?:-(\d+))?$/;

/** Peel the motif out of any (possibly already processed) name: remove date
 *  prefixes, UUIDs and long hex strings, so that nothing gets duplicated. */
function cleanMotif(name: string | null): string {
  let s = (name || '').replace(/\.[^.]+$/, '');
  // First strip our own stamp specifically — only if the name really matches our
  // pattern. Removing every group of six digits across the board would be too
  // coarse and would take apart real motifs such as "room104235".
  const m = KLARBILD_NAME.exec(s);
  if (m) s = m[3];
  // Work without \b — word boundaries do not bite at underscores (…_2026-07-24…).
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ');    // UUID
  s = s.replace(/\d{4}-\d{2}-\d{2}/g, ' ');                                                // date (also more than once)
  s = s.replace(/[0-9a-f]{16,}/gi, ' ');                                                   // long hex strings
  return slugify(s);
}

/** Time zone for the stamp in the file name. Deliberately the local time of the
 *  installation — an image taken at 0:30 should not be dated to the previous day
 *  (which is what UTC would do). */
const TZ = process.env.KLARBILD_TZ || 'Europe/Berlin';
const STAMP_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** "2026-08-20_143207" — sorted lexicographically = sorted chronologically. */
export function timeStamp(at: Date = new Date()): string {
  const p: Record<string, string> = {};
  for (const { type, value } of STAMP_FMT.formatToParts(at)) p[type] = value;
  // Some Node versions return "24" instead of "00" for midnight.
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}_${hh}${p.minute}${p.second}`;
}

/** Four-character short id, **derived stably from the item id**.
 *  Stable matters: a second run of the renaming has to give the same name,
 *  otherwise the files move again on every run. */
export function shortTag(id?: string | null): string {
  const hex = String(id || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex.length >= 4) return hex.slice(0, 4);
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
}

export interface NameParts {
  /** Original file name, out of which the motif is peeled. */
  originalName?: string | null;
  formatToken?: string;
  ext?: string;
  /** Point in time for the stamp — when renaming, the `created_at` of the image. */
  at?: Date;
  /** Item id for the stable short id. */
  id?: string | null;
  /** Counter, in case the name is taken after all (2, 3, …). */
  seq?: number;
}

/**
 * Unique, chronologically sortable file name:
 * `YYYY-MM-DD_HHMMSS_<motif>_<format>_<short-id>.<ext>`
 * e.g. `2026-08-20_143207_portrait_the-frame_a3f9.png`
 *
 * Why like this: the name begins with the timestamp, so every file listing
 * (delivery target, Finder, backup mirror) sorts chronologically by itself. It
 * becomes unique through the second **and** the short id derived from the item
 * id — two images of the same subject in the same format on the same day no
 * longer overwrite each other.
 */
export function buildResultFilename(
  originalName: string | null, formatToken: string, ext = 'png', opts: Omit<NameParts, 'originalName' | 'formatToken' | 'ext'> = {},
): string {
  const raw = cleanMotif(originalName);
  const motif = (!raw || GENERIC.has(raw)) ? 'klarbild' : raw;
  const fmt = slugify(formatToken) || 'original';
  const seq = opts.seq && opts.seq > 1 ? `-${opts.seq}` : '';
  return `${timeStamp(opts.at)}_${motif}_${fmt}_${shortTag(opts.id)}${seq}.${ext}`;
}

export interface OldName { motif: string; format: string; ext: string }

/**
 * Split an existing name into motif, format and extension — for the renaming, so
 * that the names already chosen stay and only the timestamp plus short id are
 * set anew.
 */
export function splitOldName(filename: string | null): OldName {
  const raw = String(filename || '');
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase() : 'png';
  const stem = dot > 0 ? raw.slice(0, dot) : raw;

  // Already in the new scheme: take over motif and format unchanged.
  const already = KLARBILD_NAME.exec(stem);
  if (already) return { motif: already[3], format: already[4], ext };

  const parts = stem.split('_').filter(Boolean);
  if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0] || '')) parts.shift();     // old date prefix
  const format = parts.length > 1 ? slugify(parts.pop()!) : 'original';
  const motif = slugify(parts.join('-')) || 'klarbild';
  return { motif: motif || 'klarbild', format: format || 'original', ext };
}

/** The name an existing image would have to carry under the new scheme. */
export function newNameFor(it: { id: string; filename: string | null; created_at: Date | string }, seq = 1): string {
  const { motif, format, ext } = splitOldName(it.filename);
  const at = it.created_at instanceof Date ? it.created_at : new Date(it.created_at);
  const s = seq > 1 ? `-${seq}` : '';
  return `${timeStamp(at)}_${motif}_${format}_${shortTag(it.id)}${s}.${ext}`;
}

/** Format key for the file name (from the output_format). */
export function formatToken(outputFormat: string | undefined): string {
  if (!outputFormat || outputFormat === 'keep') return 'original';
  if (outputFormat === 'theframe') return 'the-frame';
  if (outputFormat === 'portrait916') return 'portrait916';
  return outputFormat.toLowerCase(); // 30x40, a4, sticker, …
}

/* ---------------------------------------------------------------------------
 * Names for print files
 *
 * The same rule as for library results, for the same reason: two print sheets on
 * the same day were both called `2026-09-01_print-sheet.pdf` — the browser
 * appended "(1)", and whoever put the file on the backup mirror or into a folder
 * overwrote the first sheet. Exactly the bug that was fixed for the images in
 * August.
 * ------------------------------------------------------------------------ */

/** Short token for the paper: "A4" → `a4`, otherwise the size in mm (`210x297`). */
export function paperToken(paperId: string | null | undefined, wMm: number, hMm: number): string {
  const s = slugify(String(paperId || ''));
  if (s && s.length <= 12) return s;
  return `${Math.round(wMm)}x${Math.round(hMm)}`;
}

/**
 * Name for a print sheet:
 * `2026-09-01_143207_print-9-pieces_a4_4eca.pdf`
 *
 * The short id comes from the id of the history entry — so the file can be
 * matched to an entry under "Last printed".
 */
export function buildSheetFilename(opts: {
  /** Name the caller wants, otherwise one is built from pieces and sheets. */
  name?: string | null;
  paperId?: string | null;
  wMm: number; hMm: number;
  pieces: number; pages: number;
  runId?: string | null;
  at?: Date;
}): string {
  const pieces = opts.pieces === 1 ? 'print-1-piece' : `print-${opts.pieces}-pieces`;
  const sheets = opts.pages > 1 ? `-${opts.pages}-sheets` : '';
  const motif = slugify(String(opts.name || '')) || `${pieces}${sheets}`;
  return buildResultFilename(motif, paperToken(opts.paperId, opts.wMm, opts.hMm), 'pdf',
    { id: opts.runId, at: opts.at });
}

/**
 * Name for a single image brought to size:
 * `2026-09-01_143207_portrait-badge_13x18_25b3.jpg`
 * The motif comes from the source file, the short id from the image id.
 */
export function buildSingleFilename(opts: {
  name?: string | null;
  sourceName?: string | null;
  wMm: number; hMm: number;
  ext: string;
  id?: string | null;
  at?: Date;
}): string {
  const motif = String(opts.name || '') || String(opts.sourceName || '');
  const size = `${trimNumber(opts.wMm)}x${trimNumber(opts.hMm)}`;
  return buildResultFilename(motif, size, opts.ext, { id: opts.id, at: opts.at });
}

/** 45 → "45", 112.5 → "112-5" (in a file name a dot means the extension). */
function trimNumber(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', '-');
}

/**
 * Read the file name out of a `Content-Disposition` header.
 *
 * The browser gets the name from the server — the client should **not invent one
 * of its own**, otherwise there are two truths. That is exactly what happened:
 * the server sent a name, and the interface overwrote it with one of its own
 * that only contained the date.
 */
export function filenameFromHeader(header: string | null | undefined, fallback: string): string {
  const h = String(header || '');
  // RFC 5987 (filename*=UTF-8''…) takes precedence over the plain filename=.
  const star = /filename\*=UTF-8''([^;]+)/i.exec(h);
  if (star) { try { return safe(decodeURIComponent(star[1])) || fallback; } catch { /* carry on below */ } }
  const plain = /filename="?([^";]+)"?/i.exec(h);
  if (plain) return safe(plain[1]) || fallback;
  return fallback;
}

/** A name read out of a header must never contain a path. */
function safe(n: string): string {
  return n.replace(/[\\/\r\n\0]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
}

/**
 * Name for a ZIP of a selection from the library:
 * `2026-09-01_143207_selection-12-images_a3f9.zip`
 *
 * Before, every one of them was called `klarbild_2026-09-01.zip` — two different
 * selections on the same day in the same folder, and the second overwrote the
 * first.
 */
export function buildSelectionZipName(count: number, at: Date = new Date()): string {
  const what = count === 1 ? 'selection-1-image' : `selection-${count}-images`;
  return `${timeStamp(at)}_${what}_${shortTag(null)}.zip`;
}
