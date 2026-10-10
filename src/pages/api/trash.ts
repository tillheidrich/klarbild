import type { APIRoute } from 'astro';
import { query } from '../../lib/db';
import { has, moduleOff } from '../../lib/modules';
import { trashItems, restoreItems, purgeItems, emptyTrash, trashDays, daysLeft } from '../../lib/trash';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f-]{36}$/i;

/** What is in the trash — your own images, or all of them for an admin. */
export const GET: APIRoute = async ({ locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const days = await trashDays();
  const rows = await query<any>(
    `SELECT i.id, i.filename, i.output_px, i.has_alpha, i.thumb_path, i.deleted_at, i.created_at
       FROM items i JOIN jobs j ON j.id = i.job_id
      WHERE i.deleted_at IS NOT NULL AND ($2::boolean OR j.created_by = $1)
      ORDER BY i.deleted_at DESC LIMIT 400`, [locals.user.uid, locals.user.role === 'admin']);
  return json({ days, items: rows.map((r) => ({ ...r, days_left: daysLeft(r.deleted_at, days) })) });
};

/** Body { action: 'trash' | 'restore' | 'purge', ids: [...] } — several at once, one round trip. */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string' && UUID.test(x)).slice(0, 500) : [];
  if (!ids.length) return json({ error: 'No images selected.' }, 400);
  if (b.action === 'trash') return json({ ok: true, ids: await trashItems(locals.user, ids) });
  if (b.action === 'restore') return json({ ok: true, ids: await restoreItems(locals.user, ids) });
  if (b.action === 'purge') return json({ ok: true, ids: await purgeItems(locals.user, ids) });
  return json({ error: 'Unknown action.' }, 400);
};

/** Empties the trash. */
export const DELETE: APIRoute = async ({ locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  return json({ ok: true, purged: await emptyTrash(locals.user) });
};
