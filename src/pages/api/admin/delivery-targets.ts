import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';
import { encrypt } from '../../../lib/crypto';
import { loadTargetConfig, testConnection } from '../../../lib/remotetarget';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async () => {
  if (!has('delivery')) return moduleOff('delivery');
  const rows = await query<any>(`SELECT id, name, protocol, host, port, username, base_path, is_backup, metadata_sidecar,
    (password_enc IS NOT NULL) AS password_set FROM delivery_targets ORDER BY name`);
  return json({ targets: rows });
};

// POST: create | { action:'test', id } | { action:'backup_all' }
export const POST: APIRoute = async ({ request }) => {
  if (!has('delivery')) return moduleOff('delivery');
  const b = await request.json();
  if (b.action === 'test') {
    const cfg = await loadTargetConfig(b.id);
    if (!cfg) return json({ ok: false, message: 'Target is not fully configured.' });
    return json(await testConnection(cfg));
  }
  if (b.action === 'backup_all') {
    const { backupAll } = await import('../../../lib/backup');
    return json(await backupAll());
  }
  if (!b.name?.trim()) return json({ error: 'Name is missing.' }, 400);
  const row = await one<any>(
    `INSERT INTO delivery_targets (name, protocol, host, port, username, password_enc, base_path, is_backup, metadata_sidecar)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [b.name.trim(), b.protocol || 'sftp', b.host || null, b.port || null, b.username || null,
     b.password ? encrypt(String(b.password)) : null, b.base_path || null, !!b.is_backup, !!b.metadata_sidecar]);
  return json({ id: row!.id });
};

// PATCH: edit
export const PATCH: APIRoute = async ({ request }) => {
  if (!has('delivery')) return moduleOff('delivery');
  const b = await request.json();
  if (!b.id) return json({ error: 'No id.' }, 400);
  const sets: string[] = []; const args: any[] = [];
  const set = (c: string, v: any) => { args.push(v); sets.push(`${c}=$${args.length}`); };
  for (const c of ['name', 'protocol', 'host', 'port', 'username', 'base_path']) {
    if (c in b) set(c, b[c] === '' ? null : b[c]);
  }
  if ('is_backup' in b) set('is_backup', !!b.is_backup);
  if ('metadata_sidecar' in b) set('metadata_sidecar', !!b.metadata_sidecar);
  if (b.password) set('password_enc', encrypt(String(b.password)));
  if (!sets.length) return json({ ok: true });
  args.push(b.id);
  await query(`UPDATE delivery_targets SET ${sets.join(',')} WHERE id=$${args.length}`, args);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  if (!has('delivery')) return moduleOff('delivery');
  let id = url.searchParams.get('id');
  if (!id) { try { id = (await request.json())?.id; } catch { /* no matter */ } }
  if (!id) return json({ error: 'No id.' }, 400);
  await query('DELETE FROM delivery_targets WHERE id=$1', [id]);
  return json({ ok: true });
};
