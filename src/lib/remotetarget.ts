// Delivery to a remote target via SFTP (ssh2-sftp-client) or FTPS (basic-ftp).
// The configuration comes from settings (with an encrypted password).
import posixpath from 'node:path/posix';
import { one } from './db.ts';
import { decrypt } from './crypto.ts';

export interface RemoteTargetCfg {
  host: string; protocol: 'ftps' | 'sftp'; port: number;
  user: string; password: string; basePath: string;
}

export async function loadConfig(): Promise<RemoteTargetCfg | null> {
  const s = await one<any>(`SELECT delivery_host, delivery_protocol, delivery_port, delivery_user,
    delivery_password_enc, delivery_base_path FROM settings WHERE id=1`);
  if (!s?.delivery_host || !s?.delivery_user || !s?.delivery_password_enc) return null;
  let password = '';
  try { password = decrypt(s.delivery_password_enc); } catch { return null; }
  return {
    host: s.delivery_host, protocol: (s.delivery_protocol || 'sftp'),
    port: s.delivery_port || (s.delivery_protocol === 'ftps' ? 21 : 22),
    user: s.delivery_user, password, basePath: s.delivery_base_path || '/',
  };
}

/** An additional delivery target from delivery_targets. */
export async function loadTargetConfig(id: string): Promise<RemoteTargetCfg | null> {
  const s = await one<any>(`SELECT protocol, host, port, username, password_enc, base_path
    FROM delivery_targets WHERE id=$1`, [id]);
  if (!s?.host || !s?.username || !s?.password_enc) return null;
  let password = '';
  try { password = decrypt(s.password_enc); } catch { return null; }
  return {
    host: s.host, protocol: (s.protocol || 'sftp'),
    port: s.port || (s.protocol === 'ftps' ? 21 : 22),
    user: s.username, password, basePath: s.base_path || '/',
  };
}

/** Test the connection: connect + list the base folder. */
export async function testConnection(cfg: RemoteTargetCfg): Promise<{ ok: boolean; message: string }> {
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
    return { ok: true, message: 'Connection succeeded.' };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Connection failed.' };
  }
}

/**
 * A path segment that can be appended to the base folder without danger.
 *
 * `posixpath.join` is **no** protection: `join('/customers/acme', '../../../etc/cron.d')`
 * yields `/etc/cron.d`, and the upload creates the directory beforehand. Folder
 * names and file names come from the database (preset recipes, folders,
 * settings) and therefore ultimately from user input — so they are checked
 * **immediately before writing**, not somewhere further up. Nobody who delivers
 * can get around this point.
 */
export function safeSegment(value: string, what: 'folder' | 'file name'): string {
  const v = String(value || '').trim();
  if (!v) return '';
  // Deliberately a block list of the *dangerous* constructs rather than a narrow
  // allow list: a customer folder is allowed to be called "Søren & Co. (2026)" —
  // that is harmless. Only separators, control characters and names made purely
  // of dots are dangerous, because those alone are enough to leave the base folder.
  if (/[\/\\]/.test(v)) throw new Error(`Invalid ${what}: no slashes allowed.`);
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new Error(`Invalid ${what}: control characters.`);
  if (/^\.+$/.test(v)) throw new Error(`Invalid ${what}: "." and ".." are not names.`);
  if (v.length > 128) throw new Error(`Invalid ${what}: too long.`);
  return v;
}

/** Uploads a buffer straight under its final name.
 * (The delivery target does not cope with the temp-then-rename pattern — `.tmp-…`
 *  files were left lying around.) */
export async function uploadBuffer(cfg: RemoteTargetCfg, folder: string, filename: string, buf: Buffer): Promise<void> {
  const dir = posixpath.join(cfg.basePath || '/', safeSegment(folder, 'folder'));
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

/** Deletes `.tmp-…` leftovers from a folder (a one-off cleanup helper). */
export async function cleanupTmp(cfg: RemoteTargetCfg, folder: string): Promise<number> {
  const dir = posixpath.join(cfg.basePath || '/', folder || '');
  let n = 0;
  if (cfg.protocol === 'sftp') {
    const SftpClient = (await import('ssh2-sftp-client')).default;
    const c = new SftpClient();
    await c.connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 20000 });
    try {
      const list = await c.list(dir);
      for (const e of list) if (e.name.startsWith('.tmp-')) { await c.delete(posixpath.join(dir, e.name)); n++; }
    } finally { await c.end(); }
  }
  return n;
}
