import { one, query } from './db';
import { getObject } from './storage';
import { loadConfig, loadTargetConfig, uploadBuffer, type RemoteTargetCfg } from './remotetarget';

// Fallback folder on the remote target when nothing else is configured.
const DEFAULT_FOLDER = process.env.DELIVERY_DEFAULT_FOLDER || 'klarbild';

async function folderFor(item: { folder_id: string | null; job_id: string }): Promise<string> {
  // 1) folder mapping  2) preset recipe  3) configured default folder  4) fallback constant
  if (item.folder_id) {
    const f = await one<{ delivery_folder: string | null }>('SELECT delivery_folder FROM folders WHERE id=$1', [item.folder_id]);
    if (f?.delivery_folder) return f.delivery_folder;
  }
  const j = await one<{ recipe_snapshot: any }>('SELECT recipe_snapshot FROM jobs WHERE id=$1', [item.job_id]);
  if (j?.recipe_snapshot?.delivery_folder) return j.recipe_snapshot.delivery_folder;
  const s = await one<{ delivery_default_folder: string | null }>('SELECT delivery_default_folder FROM settings WHERE id=1');
  return s?.delivery_default_folder || DEFAULT_FOLDER;
}

export async function cfgForKey(key: string | null | undefined): Promise<RemoteTargetCfg | null> {
  if (!key) return null;
  if (key === 'mirror') { const { loadMirrorConfig } = await import('./mirror'); return (await loadMirrorConfig()) as unknown as RemoteTargetCfg; }
  if (key === 'remote') return loadConfig();
  return loadTargetConfig(key); // UUID of an additional target
}

/** Target credentials including the source key: 1) folder target  2) preset-recipe target  3) the default delivery target. */
async function targetFor(item: { folder_id: string | null; job_id: string }): Promise<{ cfg: RemoteTargetCfg; key: string } | null> {
  if (item.folder_id) {
    const f = await one<{ delivery_target_id: string | null }>('SELECT delivery_target_id FROM folders WHERE id=$1', [item.folder_id]).catch(() => null);
    if (f?.delivery_target_id) { const c = await cfgForKey(f.delivery_target_id); if (c) return { cfg: c, key: f.delivery_target_id }; }
  }
  const j = await one<{ recipe_snapshot: any }>('SELECT recipe_snapshot FROM jobs WHERE id=$1', [item.job_id]);
  const tid = j?.recipe_snapshot?.delivery_target_id;
  if (tid) { const c = await cfgForKey(tid); if (c) return { cfg: c, key: tid }; }
  const c = await loadConfig();
  return c ? { cfg: c, key: 'remote' } : null;
}

/** Is the metadata sidecar file switched on for this source? */
async function sidecarForKey(key: string): Promise<boolean> {
  if (key === 'remote') { const s = await one<any>('SELECT delivery_metadata_sidecar FROM settings WHERE id=1'); return !!s?.delivery_metadata_sidecar; }
  if (key === 'mirror') { const s = await one<any>('SELECT mirror_metadata_sidecar FROM settings WHERE id=1'); return !!s?.mirror_metadata_sidecar; }
  const t = await one<any>('SELECT metadata_sidecar FROM delivery_targets WHERE id=$1', [key]);
  return !!t?.metadata_sidecar;
}

/** Delivers a finished item to the matching folder on the delivery target.
 *  What gets delivered is the stored result **in the chosen format** (PNG/JPG per
 *  the global or the preset-recipe setting) — no forced conversion any more. */
export async function deliverItem(itemId: string): Promise<{ ok: boolean; message: string }> {
  const it = await one<any>('SELECT id, result_path, filename, folder_id, job_id FROM items WHERE id=$1', [itemId]);
  if (!it?.result_path) return { ok: false, message: 'No result available.' };
  const target = await targetFor(it);
  if (!target) { await query(`UPDATE items SET delivery_status='failed' WHERE id=$1`, [itemId]); return { ok: false, message: 'No delivery target configured.' }; }
  const { cfg, key } = target;

  await query(`UPDATE items SET delivery_status='pending' WHERE id=$1`, [itemId]);
  try {
    const folder = await folderFor(it);
    const buf = await getObject(it.result_path);
    const name = it.filename || `${it.id}.png`;
    await uploadBuffer(cfg, folder, name, buf);
    // Optional: metadata as an accompanying .md file — switchable per source.
    if (await sidecarForKey(key)) {
      try {
        const { buildMetadataMd, sidecarName } = await import('./metadata');
        await uploadBuffer(cfg, folder, sidecarName(name), Buffer.from(await buildMetadataMd(itemId), 'utf8'));
      } catch (e) { console.error('[delivery] metadata sidecar file failed', e); }
    }
    await query(`UPDATE items SET delivery_status='delivered', delivered_at=now() WHERE id=$1`, [itemId]);
    return { ok: true, message: `Delivered to "${folder}".` };
  } catch (e: any) {
    console.error('[delivery] item', itemId, 'failed:', e?.message || e);
    await query(`UPDATE items SET delivery_status='failed' WHERE id=$1`, [itemId]);
    return { ok: false, message: e?.message || 'Delivery failed.' };
  }
}

/** Work through all deliveries of a job that are still open (pending). */
export async function deliverPendingForJob(jobId: string): Promise<void> {
  const items = await query<{ id: string }>(
    `SELECT id FROM items WHERE job_id=$1 AND delivery_status='pending' AND status='done'`, [jobId]);
  for (const it of items) await deliverItem(it.id);
}
