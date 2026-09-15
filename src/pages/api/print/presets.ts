import type { APIRoute } from 'astro';
import { query, one } from '../../../lib/db';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Sheet presets: paper, marks, image sizes and quantities — without the images. */
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const s = await one<any>('SELECT anonymous_generations FROM settings WHERE id=1');
  const hideName = !!s?.anonymous_generations && locals.user.role !== 'admin';
  const rows = await query(
    `SELECT p.id, p.name, p.config, p.created_at, p.created_by,
            ${hideName ? 'NULL' : 'u.display_name'} AS by_name
       FROM print_presets p LEFT JOIN users u ON u.id = p.created_by
      ORDER BY p.name ASC LIMIT 200`);
  return json({ presets: rows });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const body = await request.json().catch(() => null) as any;
  const name = String(body?.name || '').trim();
  if (!name) return json({ error: 'Name is missing.' }, 400);
  if (!body?.config || typeof body.config !== 'object') return json({ error: 'Configuration is missing.' }, 400);
  // Presets are served to every user — hence a hard size limit.
  const cfg = JSON.stringify(body.config);
  if (cfg.length > 20000) return json({ error: 'Preset is too large.' }, 400);
  const mine = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM print_presets WHERE created_by IS NOT DISTINCT FROM $1`, [locals.user.uid]);
  if (Number(mine?.n || 0) >= 100) return json({ error: 'Too many presets — please clean up first.' }, 400);
  const row = await one(
    `INSERT INTO print_presets (name, created_by, config) VALUES ($1,$2,$3) RETURNING id, name, config`,
    [name.slice(0, 80), locals.user.uid, cfg]);
  return json({ preset: row });
};

export const DELETE: APIRoute = async ({ url, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is missing.' }, 400);
  // Only your own presets (admins may do anything) — otherwise anyone could
  // delete someone else's nursery set.
  const isAdmin = locals.user.role === 'admin';
  const del = await query(
    `DELETE FROM print_presets WHERE id=$1 AND ($2::bool OR created_by IS NOT DISTINCT FROM $3) RETURNING id`,
    [id, isAdmin, locals.user.uid]);
  if (!del.length) return json({ error: 'Preset not found, or not yours.' }, 404);
  return json({ ok: true });
};
