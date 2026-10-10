// The trash: delete softly, restore, empty, and let maintenance finish the job.
import { one, query } from './db.ts';
import { deleteObject } from './storage.ts';
import type { Viewer } from './itemaccess.ts';

export const DEFAULT_TRASH_DAYS = 30;

/** Every stored object an image row points to. */
export function objectKeysOf(it: {
  source_path?: string | null; source_paths?: string[] | null; result_path?: string | null; thumb_path?: string | null;
}): string[] {
  const keys = [it.source_path, it.result_path, it.thumb_path, ...(it.source_paths || [])]
    .filter((k): k is string => typeof k === 'string' && k.length > 0);
  return [...new Set(keys)];
}

/**
 * Days until an image in the trash is removed for good. Rounded up, never below
 * zero: "0 days" means the next maintenance run takes it.
 */
export function daysLeft(deletedAt: Date | string, trashDays: number, now: Date = new Date()): number {
  const gone = new Date(deletedAt).getTime() + trashDays * 86_400_000;
  return Math.max(0, Math.ceil((gone - now.getTime()) / 86_400_000));
}

export async function trashDays(): Promise<number> {
  const s = await one<{ trash_days: number | null }>('SELECT trash_days FROM settings WHERE id=1');
  const d = s?.trash_days;
  return typeof d === 'number' && d >= 0 ? d : DEFAULT_TRASH_DAYS;
}

/** SQL condition: rows this viewer may change. `$1` = uid, `$2` = is admin. */
const OWN = `($2::boolean OR i.job_id IN (SELECT id FROM jobs WHERE created_by = $1))`;

/** Moves images into the trash. Returns the ids that actually moved. */
export async function trashItems(v: Viewer, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  if ((await trashDays()) === 0) return purgeItems(v, ids, { onlyTrashed: false });
  const rows = await query<{ id: string }>(
    `UPDATE items i SET deleted_at = now()
      WHERE i.id = ANY($3::uuid[]) AND i.deleted_at IS NULL AND ${OWN}
      RETURNING i.id`, [v.uid, v.role === 'admin', ids]);
  return rows.map((r) => r.id);
}

export async function restoreItems(v: Viewer, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await query<{ id: string }>(
    `UPDATE items i SET deleted_at = NULL
      WHERE i.id = ANY($3::uuid[]) AND i.deleted_at IS NOT NULL AND ${OWN}
      RETURNING i.id`, [v.uid, v.role === 'admin', ids]);
  return rows.map((r) => r.id);
}

/**
 * Removes images for good: the row and every file that no other image still
 * uses. That last part matters — an alternative version shares its source file
 * with the original, and deleting the original must not take the source of the
 * alternative with it.
 */
export async function purgeItems(v: Viewer | null, ids: string[], opts: { onlyTrashed?: boolean } = {}): Promise<string[]> {
  if (!ids.length) return [];
  const onlyTrashed = opts.onlyTrashed !== false;
  const admin = !v || v.role === 'admin';
  const rows = await query<{ id: string; source_path: string | null; source_paths: string[] | null; result_path: string | null; thumb_path: string | null }>(
    `DELETE FROM items i
      WHERE i.id = ANY($3::uuid[]) ${onlyTrashed ? 'AND i.deleted_at IS NOT NULL' : ''} AND ${OWN}
      RETURNING i.id, i.source_path, i.source_paths, i.result_path, i.thumb_path`,
    [v?.uid ?? null, admin, ids]);
  for (const r of rows) {
    for (const k of objectKeysOf(r)) {
      // `source_paths` is jsonb, not a Postgres array. A failure here must not stop
      // the loop: the rows are already gone, and a skipped file is only wasted
      // space, while an exception would skip every file after it.
      try {
        const still = await one<{ n: number }>(
          `SELECT count(*)::int AS n FROM items
            WHERE source_path = $1 OR result_path = $1 OR thumb_path = $1
               OR source_paths @> jsonb_build_array($1::text)`, [k]);
        if (!still?.n) await deleteObject(k);
      } catch (e) { console.error('[trash] could not remove', k, (e as Error)?.message); }
    }
  }
  return rows.map((r) => r.id);
}

/** Empties the trash: the viewer's own images, or all of them for an admin. */
export async function emptyTrash(v: Viewer): Promise<number> {
  const ids = await query<{ id: string }>(
    `SELECT i.id FROM items i WHERE i.deleted_at IS NOT NULL AND ${OWN}`, [v.uid, v.role === 'admin']);
  return (await purgeItems(v, ids.map((r) => r.id))).length;
}

/** Maintenance: everything that has been in the trash longer than the setting allows. */
export async function purgeExpiredTrash(): Promise<number> {
  const days = await trashDays();
  const ids = await query<{ id: string }>(
    `SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < now() - ($1 || ' days')::interval`, [String(days)]);
  return (await purgeItems(null, ids.map((r) => r.id))).length;
}
