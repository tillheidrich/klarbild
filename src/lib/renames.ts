// Unique file names — assigning them for new images and renaming the library.
//
// Background: until 2026-08-20 a result was called `YYYY-MM-DD_<motif>_<format>.<ext>`.
// Whoever produced the same motif in the same format twice on the same day — two
// badges from one shoot, say — got the same name twice. On the delivery target
// the second image overwrote the first. Since then the name also carries the
// time of day to the second and a short id derived from the item id.
import { query, one } from './db.ts';
import { buildResultFilename, newNameFor } from './naming.ts';

/** Is this name already taken by a *different* image? */
async function taken(name: string, exceptId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    'SELECT id FROM items WHERE filename = $1 AND id <> $2 LIMIT 1', [name, exceptId]);
  return !!row;
}

/**
 * The name is practically unique already through second + item short id. This
 * loop is the belt to go with the braces: it appends `-2`, `-3` … in case the
 * name is taken against all expectation. Deliberately as a loop in code and
 * **not** as a UNIQUE constraint in the database — a rejected write would make
 * an already paid-for AI job fail at the very last step.
 */
export async function uniqueFilename(
  itemId: string, originalName: string | null, formatToken: string, ext: string, at?: Date,
  /** For tests only: otherwise the library is asked. */
  isTaken: (name: string) => Promise<boolean> = (n) => taken(n, itemId),
): Promise<string> {
  for (let seq = 1; seq <= 50; seq++) {
    const name = buildResultFilename(originalName, formatToken, ext, { at, id: itemId, seq });
    if (!(await isTaken(name))) return name;
  }
  // Unreachable as long as item ids are unique — but an ugly name is preferable
  // to an overwritten image.
  return buildResultFilename(originalName, formatToken, ext, { at, id: `${itemId}${Date.now()}` });
}

export interface RenameRow { id: string; before: string; after: string }
export interface RenameResult {
  checked: number;
  renamed: number;
  unchanged: number;
  /** Names that were assigned twice before — exactly the reported bug. */
  wereDuplicates: number;
  dryRun: boolean;
  examples: RenameRow[];
}

/**
 * Bring all library images onto the new naming scheme.
 * Idempotent: the timestamp comes from `created_at`, the short id from the item
 * id — a second run changes nothing any more. The files themselves stay
 * untouched, they lie in storage under the item id, not under the name.
 */
export async function renameLibrary(dryRun = true): Promise<RenameResult> {
  const items = await query<{ id: string; filename: string | null; created_at: Date }>(
    `SELECT id, filename, created_at FROM items
      WHERE status='done' AND filename IS NOT NULL ORDER BY created_at`);

  // How many names were assigned more than once before?
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.filename!, (counts.get(it.filename!) || 0) + 1);
  const wereDuplicates = [...counts.values()].filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);

  const used = new Set<string>();
  const rows: RenameRow[] = [];
  let renamed = 0, unchanged = 0;

  for (const it of items) {
    let next = newNameFor(it);
    for (let seq = 2; used.has(next) && seq <= 50; seq++) next = newNameFor(it, seq);
    used.add(next);
    if (next === it.filename) { unchanged++; continue; }
    renamed++;
    if (rows.length < 25) rows.push({ id: it.id, before: it.filename!, after: next });
    if (!dryRun) await query('UPDATE items SET filename=$2 WHERE id=$1', [it.id, next]);
  }

  return { checked: items.length, renamed, unchanged, wereDuplicates, dryRun: dryRun, examples: rows };
}

/**
 * Deliver all images that were already delivered once again — under the new
 * name. Necessary because the renaming only affects the library: whatever
 * already lies on the delivery target is still called by its old name there. The
 * old files stay put and have to be removed by hand if wanted; deleting
 * something at the customer's end automatically would be the wrong reflex.
 */
export async function redeliverAll(): Promise<{ attempted: number; ok: number; failed: number }> {
  const items = await query<{ id: string }>(
    `SELECT i.id FROM items i JOIN jobs j ON j.id = i.job_id
      WHERE i.status='done' AND i.result_path IS NOT NULL
        AND i.delivery_status IN ('delivered','failed') AND j.private = false
      ORDER BY i.created_at`);
  const { deliverItem } = await import('./delivery.ts');
  let ok = 0, failed = 0;
  for (const it of items) {
    const r = await deliverItem(it.id).catch(() => ({ ok: false }));
    r.ok ? ok++ : failed++;
  }
  return { attempted: items.length, ok, failed };
}
