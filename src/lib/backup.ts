// Generic backup: mirrors finished results onto every backup target (the backup
// mirror from the settings + every delivery_target with is_backup), optionally
// with an accompanying metadata .md file. Structure per target:
// <base folder>/YYYY-MM/.
import { one, query } from './db';
import { getObject } from './storage';
import { uploadBuffer, loadTargetConfig, type RemoteTargetCfg } from './remotetarget';
import { loadMirrorConfig } from './mirror';
import { buildMetadataMd, sidecarName } from './metadata';

export interface BackupDest { key: string; label: string; cfg: RemoteTargetCfg; sidecar: boolean; }

/** Collect all active backup targets (including the metadata sidecar flag per target). */
export async function backupDestinations(): Promise<BackupDest[]> {
  const dests: BackupDest[] = [];
  const mirror = await loadMirrorConfig();
  if (mirror) {
    const s = await one<any>('SELECT mirror_metadata_sidecar FROM settings WHERE id=1');
    dests.push({ key: 'mirror', label: 'Backup mirror', cfg: mirror, sidecar: !!s?.mirror_metadata_sidecar });
  }
  const targets = await query<any>(`SELECT id, name, metadata_sidecar FROM delivery_targets WHERE is_backup=true`);
  for (const t of targets) {
    const cfg = await loadTargetConfig(t.id);
    if (cfg) dests.push({ key: t.id, label: t.name, cfg, sidecar: !!t.metadata_sidecar });
  }
  return dests;
}

/** Mirror one item onto every backup target. */
export async function backupItem(itemId: string): Promise<{ mirrored: number; failed: number }> {
  const dests = await backupDestinations();
  if (!dests.length) return { mirrored: 0, failed: 0 };
  const it = await one<any>('SELECT id, result_path, filename, created_at FROM items WHERE id=$1', [itemId]);
  if (!it?.result_path) return { mirrored: 0, failed: 0 };

  const buf = await getObject(it.result_path);
  const ym = new Date(it.created_at || Date.now()).toISOString().slice(0, 7);
  let md: Buffer | null = null;
  const anySidecar = dests.some((d) => d.sidecar);
  if (anySidecar) md = Buffer.from(await buildMetadataMd(itemId), 'utf8');

  let mirrored = 0, failed = 0;
  for (const d of dests) {
    try {
      await uploadBuffer(d.cfg, ym, it.filename || `${it.id}.png`, buf);
      if (d.sidecar && md) await uploadBuffer(d.cfg, ym, sidecarName(it.filename), md);
      await query(`INSERT INTO item_backups (item_id, target, status) VALUES ($1,$2,'mirrored')
                   ON CONFLICT (item_id, target) DO UPDATE SET status='mirrored', at=now()`, [itemId, d.key]);
      if (d.key === 'mirror') await query(`UPDATE items SET mirror_status='mirrored' WHERE id=$1`, [itemId]);
      mirrored++;
    } catch (e: any) {
      console.error('[backup]', d.label, itemId, e?.message || e);
      await query(`INSERT INTO item_backups (item_id, target, status) VALUES ($1,$2,'failed')
                   ON CONFLICT (item_id, target) DO UPDATE SET status='failed', at=now()`, [itemId, d.key]);
      if (d.key === 'mirror') await query(`UPDATE items SET mirror_status='failed' WHERE id=$1`, [itemId]);
      failed++;
    }
  }
  return { mirrored, failed };
}

/** Back up every finished image onto every backup target (a catch-up run). */
export async function backupAll(): Promise<{ items: number; mirrored: number; failed: number }> {
  const dests = await backupDestinations();
  if (!dests.length) return { items: 0, mirrored: 0, failed: 0 };
  const rows = await query<{ id: string }>(
    `SELECT id FROM items WHERE status='done' AND result_path IS NOT NULL ORDER BY created_at`);
  let mirrored = 0, failed = 0;
  for (const it of rows) { const r = await backupItem(it.id); mirrored += r.mirrored; failed += r.failed; }
  return { items: rows.length, mirrored, failed };
}
