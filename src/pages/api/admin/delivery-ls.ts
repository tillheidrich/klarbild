import type { APIRoute } from 'astro';
import posixpath from 'node:path/posix';
import { loadConfig, cleanupTmp } from '../../../lib/remotetarget';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Diagnostics: lists a folder on the delivery target (default: the base folder). Body { path? }
 *  Clean up: body { action:'cleanup_tmp', gallery } removes .tmp files left behind. */
export const POST: APIRoute = async ({ request }) => {
  if (!has('delivery')) return moduleOff('delivery');
  const b = await request.json().catch(() => ({} as any));
  const cfg = await loadConfig();
  if (!cfg) return json({ error: 'Delivery target is not configured.' }, 400);
  if (b.action === 'cleanup_tmp') {
    try {
      const removed = await cleanupTmp(cfg, b.gallery || '');
      return json({ cleaned: removed });
    } catch (e: any) { return json({ error: e?.message || 'Clean-up failed.' }, 500); }
  }
  const path = b.path || cfg.basePath || '/';
  try {
    if (cfg.protocol === 'sftp') {
      const SftpClient = (await import('ssh2-sftp-client')).default;
      const c = new SftpClient();
      await c.connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 15000 });
      try {
        const list = await c.list(path);
        return json({ path, entries: list.map((e: any) => ({ name: e.name, type: e.type, size: e.size })) });
      } finally { await c.end(); }
    } else {
      const { Client } = await import('basic-ftp');
      const c = new Client(15000);
      await c.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: true });
      try {
        const list = await c.list(path);
        return json({ path, entries: list.map((e: any) => ({ name: e.name, type: e.type, size: e.size })) });
      } finally { c.close(); }
    }
  } catch (e: any) {
    return json({ path, error: e?.message || 'Listing failed.' });
  }
};
