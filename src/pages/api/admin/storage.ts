import type { APIRoute } from 'astro';
import { storageStats, runRetention, purgeSources, mirrorAllToBackup, rebuildThumbs } from '../../../lib/maintenance';
import { renameLibrary, redeliverAll } from '../../../lib/renames';
import { one } from '../../../lib/db';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async () => json({ stats: await storageStats() });

// POST { action: 'retention' | 'purge_sources' | 'rename_preview' | 'rename_apply' | 'redeliver_all' | … }
export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => ({}));
  if (b.action === 'purge_sources') return json(await purgeSources());
  if (b.action === 'mirror_all') return json(await mirrorAllToBackup());
  if (b.action === 'rebuild_thumbs') return json(await rebuildThumbs());
  // Unique file names: first show what would happen, then apply it.
  if (b.action === 'rename_preview') return json(await renameLibrary(true));
  if (b.action === 'rename_apply') return json(await renameLibrary(false));
  if (b.action === 'redeliver_all') return json(await redeliverAll());
  if (b.action === 'retention') {
    const s = await one<{ retention_days: number | null }>('SELECT retention_days FROM settings WHERE id=1');
    if (!s?.retention_days) return json({ error: 'No retention period is set.' }, 400);
    return json(await runRetention(s.retention_days));
  }
  return json({ error: 'Unknown action.' }, 400);
};
