// A second copy on a backup mirror (SFTP or FTPS, same as the delivery target).
// Results are mirrored onto the backup mirror in addition to the library and
// the delivery target.
import posixpath from 'node:path/posix';
import { one, query } from './db';
import { decrypt } from './crypto';
import { getObject } from './storage';

export interface MirrorCfg {
  host: string; protocol: 'ftps' | 'sftp'; port: number;
  user: string; password: string; basePath: string;
}

export async function loadMirrorConfig(): Promise<MirrorCfg | null> {
  const s = await one<any>(`SELECT mirror_enabled, mirror_host, mirror_protocol, mirror_port, mirror_user,
    mirror_password_enc, mirror_base_path FROM settings WHERE id=1`);
  if (!s?.mirror_enabled || !s?.mirror_host || !s?.mirror_user || !s?.mirror_password_enc) return null;
  let password = '';
  try { password = decrypt(s.mirror_password_enc); } catch { return null; }
  return {
    host: s.mirror_host, protocol: (s.mirror_protocol || 'sftp'),
    port: s.mirror_port || (s.mirror_protocol === 'ftps' ? 21 : 22),
    user: s.mirror_user, password, basePath: s.mirror_base_path || '/',
  };
}

export async function testMirror(cfg: MirrorCfg): Promise<{ ok: boolean; message: string }> {
  try {
    if (cfg.protocol === 'sftp') {
      const SftpClient = (await import('ssh2-sftp-client')).default;
      const c = new SftpClient();
      await c.connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 15000 });
      await c.list(cfg.basePath || '/');
      await c.end();
    } else {
      const { Client } = await import('basic-ftp');
      const c = new Client(15000);
      await c.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: true });
      await c.list(cfg.basePath || '/');
      c.close();
    }
    return { ok: true, message: 'Connection to the backup mirror succeeded.' };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Connection to the backup mirror failed.' };
  }
}

async function uploadToMirror(cfg: MirrorCfg, remoteDir: string, filename: string, buf: Buffer): Promise<void> {
  // The same check as for the delivery target, for the same reason:
  // `posixpath.join` is no protection against `..` — the file name comes out of
  // the database and is therefore checked here, immediately before writing.
  const { safeSegment } = await import('./remotetarget');
  const dir = posixpath.join(cfg.basePath || '/', safeSegment(remoteDir, 'folder'));
  const finalPath = posixpath.join(dir, safeSegment(filename, 'file name'));
  const { Readable } = await import('node:stream');
  if (cfg.protocol === 'sftp') {
    const SftpClient = (await import('ssh2-sftp-client')).default;
    const c = new SftpClient();
    await c.connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 20000 });
    try {
      if (!(await c.exists(dir))) await c.mkdir(dir, true);
      await c.put(buf, finalPath);
    } finally { await c.end(); }
  } else {
    const { Client } = await import('basic-ftp');
    const c = new Client(20000);
    await c.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: true });
    try {
      await c.ensureDir(dir);
      await c.uploadFrom(Readable.from(buf), finalPath);
    } finally { c.close(); }
  }
}

/** Mirrors a finished item onto the backup mirror (folder structure klarbild/YYYY-MM/). */
export async function mirrorItem(itemId: string): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadMirrorConfig();
  if (!cfg) return { ok: false, message: 'Backup mirror not configured.' };
  const it = await one<any>('SELECT id, result_path, filename, created_at FROM items WHERE id=$1', [itemId]);
  if (!it?.result_path) return { ok: false, message: 'No result available.' };
  await query(`UPDATE items SET mirror_status='pending' WHERE id=$1`, [itemId]);
  try {
    const buf = await getObject(it.result_path);
    const ym = new Date(it.created_at || Date.now()).toISOString().slice(0, 7); // YYYY-MM
    // Structure: <base folder>/YYYY-MM/<file> — the base folder is freely choosable.
    await uploadToMirror(cfg, ym, it.filename || `${it.id}.png`, buf);
    await query(`UPDATE items SET mirror_status='mirrored' WHERE id=$1`, [itemId]);
    return { ok: true, message: 'Backed up to the mirror.' };
  } catch (e: any) {
    console.error('[mirror] mirror', itemId, 'failed:', e?.message || e);
    await query(`UPDATE items SET mirror_status='failed' WHERE id=$1`, [itemId]);
    return { ok: false, message: e?.message || 'Backup to the mirror failed.' };
  }
}
