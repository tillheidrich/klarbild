// Print history — what was printed last, and how to repeat it.
//
// The crucial point: what gets stored is the **instruction**, not the result.
// An A3 sheet as a PDF is easily 20–80 MB; a few dozen of those fill the disk
// with files that can be recalculated in seconds. So what lies here is the
// request body with which `/api/print/sheet` produces the same sheet again
// — around 1–3 KB per entry.
//
// That only works because the print module is **deterministic**: the same
// sources and the same settings give the same PDF. For the AI jobs it would be
// nonsense, there something different would come out every time.
import { one, query } from './db.ts';

export const MAX_RUNS_PER_USER = 100;

export interface PrintRun {
  id: string;
  created_by: string | null;
  origin: string;
  summary: string | null;
  paper: string | null;
  pages: number;
  pieces: number;
  bytes: number | null;
  config: any;
  created_at: string;
}

export interface RunInput {
  /** Predetermined id — the file name of the PDF carries its short id. */
  id?: string | null;
  userId: string | null;
  origin?: string;
  summary: string;
  paper: string;
  pages: number;
  pieces: number;
  bytes: number;
  /** The request body, unchanged. */
  config: any;
  /** Ids of the library images that were used. */
  itemIds: string[];
}

/**
 * What was on the sheet, in one sentence.
 *
 * The list comes in cell by cell — two cells with the same size would otherwise
 * give "10 × 15 cm, 10 × 15 cm". Identical sizes are therefore pulled together
 * and their piece counts added up; an existing "×3" is counted along, so that
 * "×3 ×2" does not appear.
 */
export function summarise(kinds: string[]): string {
  if (!kinds.length) return 'Print sheet';

  // Only the **trailing** piece count counts: "35 × 45 mm ×8" has two × in it,
  // and a greedy expression promptly turned "13 × 18 cm" into "13 cm ×18".
  // That is why it is anchored to the end, with an optional addition in
  // parentheses behind it.
  const COUNT = /^(.*?)\s*×\s*(\d+)(\s*\([^)]*\))?$/;

  const sums = new Map<string, number>();
  for (const k of kinds) {
    const m = COUNT.exec(k);
    const base = m ? `${m[1]}${m[3] || ''}` : k;
    const n = m ? Number(m[2]) : 1;
    sums.set(base, (sums.get(base) || 0) + n);
  }

  // "30 × 40 cm (poster) ×3" would read awkwardly — the piece count belongs in
  // front of the addition, where it came in.
  const parts = [...sums].map(([base, n]) => {
    if (n <= 1) return base;
    const z = /^(.*?)(\s*\([^)]*\))$/.exec(base);
    return z ? `${z[1]} ×${n}${z[2]}` : `${base} ×${n}`;
  });
  const s = parts.join(', ');
  return s.length <= 120 ? s : `${s.slice(0, 117)}…`;
}

/**
 * Record a print.
 *
 * An error here must **never** make the print fail — by that point the PDF has
 * long been finished and is on its way to the user. That is why the caller
 * catches, and this function only reports to the log.
 */
export async function recordRun(e: RunInput): Promise<string | null> {
  const run = await one<{ id: string }>(
    `INSERT INTO print_runs (id, created_by, origin, summary, paper, pages, pieces, bytes, config)
     VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [e.id || null, e.userId, e.origin || 'web', e.summary, e.paper, e.pages, e.pieces, e.bytes,
     JSON.stringify(e.config)]);
  if (!run) return null;

  const ids = [...new Set(e.itemIds.filter(Boolean))];
  if (ids.length) {
    // Images may have been deleted in the meantime — then the link falls away
    // and the entry stays.
    await query(
      `INSERT INTO print_run_items (run_id, item_id)
       SELECT $1, x FROM unnest($2::uuid[]) AS x
        WHERE EXISTS (SELECT 1 FROM items WHERE id = x)
       ON CONFLICT DO NOTHING`, [run.id, ids]).catch((err) =>
      console.error('[printruns] image references not stored:', err?.message || err));
  }

  // Clear away older entries of the same user. Without this the list grows
  // without bound, and nobody scrolls back to a print from two years ago.
  if (e.userId) {
    await query(
      `DELETE FROM print_runs
        WHERE created_by = $1 AND id NOT IN (
          SELECT id FROM print_runs WHERE created_by = $1
           ORDER BY created_at DESC LIMIT $2)`,
      [e.userId, MAX_RUNS_PER_USER]).catch(() => {});
  }
  return run.id;
}

export interface RunRow extends PrintRun {
  /** Images that still exist — only with those can the print be repeated. */
  images: { id: string; filename: string | null }[];
  /** How many **library images** have been deleted since. */
  missing: number;
  /** How many cells came from an uploaded file — those are gone. */
  uploaded: number;
  /** Can the sheet be produced again unchanged? */
  repeatable: boolean;
}

/**
 * The most recent prints. Admins see all of them, everybody else only their
 * own — the same rule as for the share links.
 */
export async function listRuns(userId: string | null, isAdmin: boolean, limit = 30): Promise<RunRow[]> {
  const runs = await query<PrintRun>(
    `SELECT * FROM print_runs
      WHERE $2::boolean OR created_by = $1
      ORDER BY created_at DESC LIMIT $3`, [userId, isAdmin, Math.min(limit, 100)]);
  if (!runs.length) return [];

  const images = await query<{ run_id: string; id: string; filename: string | null }>(
    `SELECT ri.run_id, i.id, i.filename
       FROM print_run_items ri JOIN items i ON i.id = ri.item_id
      WHERE ri.run_id = ANY($1::uuid[]) AND i.status = 'done' AND i.result_path IS NOT NULL`,
    [runs.map((r) => r.id)]);

  const byRun = new Map<string, { id: string; filename: string | null }[]>();
  for (const b of images) {
    const l = byRun.get(b.run_id) || [];
    l.push({ id: b.id, filename: b.filename });
    byRun.set(b.run_id, l);
  }

  return runs.map((r) => {
    const present = byRun.get(r.id) || [];
    const cells: any[] = Array.isArray(r.config?.cells) ? r.config.cells : [];
    // Only cells from the library can be repeated. Uploaded files lie under
    // `sources/…` and are cleaned up after processing depending on the settings
    // — then the source is missing.
    const fromLibrary = cells.filter((c) => c?.src?.kind === 'item').length;
    // Different reasons, explained differently: a deleted library image is
    // something other than a file that was never in the library. Throwing both
    // into one counter led to "1 image is no longer there" for a sheet whose
    // source was simply an upload.
    const distinct = new Set(cells.filter((c) => c?.src?.kind === 'item')
      .map((c) => String(c.src.id))).size;
    return {
      ...r,
      images: present,
      missing: Math.max(0, distinct - present.length),
      uploaded: cells.length - fromLibrary,
      // Repeatable only if **all** cells come from the library and all images
      // are still there. Half will not do: a sheet with a missing image would
      // not be the same sheet.
      repeatable: cells.length > 0 && fromLibrary === cells.length && present.length === cells.length,
    };
  });
}

/** Fetch a single print — for producing it again. */
export async function getRun(id: string, userId: string | null, isAdmin: boolean): Promise<PrintRun | null> {
  return one<PrintRun>(
    `SELECT * FROM print_runs WHERE id = $1 AND ($3::boolean OR created_by = $2)`,
    [id, userId, isAdmin]);
}

export async function deleteRun(id: string, userId: string | null, isAdmin: boolean): Promise<boolean> {
  const r = await query<{ id: string }>(
    `DELETE FROM print_runs WHERE id = $1 AND ($3::boolean OR created_by = $2) RETURNING id`,
    [id, userId, isAdmin]);
  return r.length > 0;
}
