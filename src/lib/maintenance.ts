// Storage management: show usage, clean up (retention), delete sources.
// The aim: do not let the server silt up.
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { one, query } from './db';
import { deleteObject } from './storage';

const DRIVER = (process.env.STORAGE_DRIVER || 'fs').toLowerCase();
const DIR = process.env.STORAGE_DIR || '/data';

async function dirBytes(path: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0, files = 0;
  let entries: any[] = [];
  try { entries = await readdir(path, { withFileTypes: true }); } catch { return { bytes, files }; }
  for (const e of entries) {
    const p = join(path, e.name);
    if (e.isDirectory()) { const s = await dirBytes(p); bytes += s.bytes; files += s.files; }
    else { try { const st = await stat(p); bytes += st.size; files++; } catch { /* ignore */ } }
  }
  return { bytes, files };
}

export interface StorageStats {
  driver: string; bytes: number | null; files: number | null;
  sources: number; results: number; thumbs: number; items: number;
}

/** Storage figures. Byte accuracy only with the fs driver. */
export async function storageStats(): Promise<StorageStats> {
  const counts = await one<any>(`SELECT
      count(*) FILTER (WHERE source_path IS NOT NULL)::int AS sources,
      count(*) FILTER (WHERE result_path IS NOT NULL)::int AS results,
      count(*) FILTER (WHERE thumb_path IS NOT NULL)::int AS thumbs,
      count(*)::int AS items FROM items`);
  let bytes: number | null = null, files: number | null = null;
  if (DRIVER === 'fs') { const s = await dirBytes(DIR); bytes = s.bytes; files = s.files; }
  return { driver: DRIVER, bytes, files,
    sources: counts?.sources || 0, results: counts?.results || 0,
    thumbs: counts?.thumbs || 0, items: counts?.items || 0 };
}

/** Deletes items (objects included) that are older than N days. */
export async function runRetention(days: number): Promise<{ deleted: number }> {
  if (!days || days <= 0) return { deleted: 0 };
  const rows = await query<any>(
    `SELECT id, source_path, source_paths, result_path, thumb_path FROM items
      WHERE created_at < now() - ($1 || ' days')::interval`, [String(days)]);
  for (const it of rows) {
    const keys = [it.source_path, it.result_path, it.thumb_path,
      ...((it.source_paths as string[]) || [])].filter(Boolean);
    for (const k of keys) await deleteObject(k).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [it.id]);
  }
  return { deleted: rows.length };
}

/** Produces missing preview images afterwards (for a fast library view). */
export async function rebuildThumbs(): Promise<{ made: number }> {
  const { getObject, putObject, thumbKey } = await import('./storage');
  const sharp = (await import('sharp')).default;
  const rows = await query<any>(
    `SELECT id, result_path FROM items WHERE status='done' AND result_path IS NOT NULL AND thumb_path IS NULL`);
  let made = 0;
  for (const it of rows) {
    try {
      const out = await sharp(await getObject(it.result_path), { failOn: 'none' })
        .resize(600, 600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
      const tk = thumbKey(it.id);
      await putObject(tk, out, 'image/webp');
      await query(`UPDATE items SET thumb_path=$2 WHERE id=$1`, [it.id, tk]);
      made++;
    } catch (e) { console.error('[maintenance] Thumb', it.id, e); }
  }
  return { made };
}

/** Deletes only the source images of finished items (the results stay). */
export async function purgeSources(): Promise<{ purged: number }> {
  const rows = await query<any>(
    `SELECT id, source_path, source_paths FROM items WHERE status='done'
       AND (source_path IS NOT NULL OR source_paths IS NOT NULL)`);
  let purged = 0;
  for (const it of rows) {
    const keys = [it.source_path, ...((it.source_paths as string[]) || [])].filter(Boolean);
    for (const k of keys) await deleteObject(k).catch(() => {});
    await query('UPDATE items SET source_path=NULL, source_paths=NULL WHERE id=$1', [it.id]);
    purged += keys.length;
  }
  return { purged };
}

/** Mirrors all finished images to all backup targets (backup mirror + is_backup targets). */
export async function mirrorAllToBackup(): Promise<{ mirrored: number; failed: number; total: number }> {
  const { backupAll } = await import('./backup');
  const r = await backupAll();
  return { mirrored: r.mirrored, failed: r.failed, total: r.items };
}

/** "Forget" private jobs: delete results + jobs after a short time. */
export async function purgePrivate(olderThanMin = 60): Promise<{ deleted: number }> {
  const rows = await query<any>(
    `SELECT i.id, i.result_path, i.thumb_path FROM items i JOIN jobs j ON j.id=i.job_id
       WHERE j.private=true AND i.created_at < now() - ($1 || ' minutes')::interval`, [String(olderThanMin)]);
  for (const it of rows) {
    for (const k of [it.result_path, it.thumb_path].filter(Boolean)) await deleteObject(k).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [it.id]);
  }
  // remove empty private jobs
  await query(`DELETE FROM jobs WHERE private=true AND id NOT IN (SELECT DISTINCT job_id FROM items WHERE job_id IS NOT NULL)`);
  return { deleted: rows.length };
}

/**
 * Clear away records and expired reset links.
 *
 * Both tables used to grow without bound. With `share_views` that is not only a
 * question of space: they are records of when somebody looked at an image.
 * Keeping them longer than you need them would simply be unnecessary — 90 days
 * are enough for "was that actually looked at?".
 */
export async function purgeTracking(days = 90): Promise<{ views: number; resets: number }> {
  const v = await query<{ id: string }>(
    `DELETE FROM share_views WHERE at < now() - ($1 || ' days')::interval RETURNING id`, [String(days)]);
  const r = await query<{ token_hash: string }>(
    `DELETE FROM password_resets
      WHERE expires_at < now() - interval '7 days' RETURNING token_hash`);
  return { views: v.length, resets: r.length };
}

let timer: NodeJS.Timeout | null = null;
/** Maintenance run: retention + forgetting private sessions. */
export function startMaintenance(): void {
  if (timer) return;
  const tick = async () => {
    try {
      const s = await one<{ retention_days: number | null }>('SELECT retention_days FROM settings WHERE id=1');
      if (s?.retention_days && s.retention_days > 0) {
        const r = await runRetention(s.retention_days);
        if (r.deleted) console.log(`[maintenance] Retention: ${r.deleted} old items removed.`);
      }
      const p = await purgePrivate(60);
      if (p.deleted) console.log(`[maintenance] Private: ${p.deleted} results forgotten.`);
      const t = await purgeTracking(90);
      if (t.views || t.resets) console.log(`[maintenance] Cleaned up: ${t.views} views, ${t.resets} old reset links.`);
    } catch (e) { console.error('[maintenance]', e); }
  };
  timer = setInterval(tick, 30 * 60 * 1000);  // every 30 min (also for the private purge)
  setTimeout(tick, 60 * 1000);                 // first run after 1 min
}
