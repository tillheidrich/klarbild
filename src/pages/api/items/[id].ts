import type { APIRoute } from 'astro';
import { one } from '../../../lib/db';
import { loadItemFor } from '../../../lib/itemaccess';
import { trashItems, purgeItems } from '../../../lib/trash';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  if (!(await loadItemFor(locals.user, params.id!, 'write'))) return json({ error: 'Not found.' }, 404);
  const b = await request.json().catch(() => ({} as any));
  const sets: string[] = []; const args: any[] = [];
  if (typeof b.filename === 'string') { args.push(b.filename.trim()); sets.push(`filename=$${args.length}`); }
  if ('folder_id' in b) { args.push(b.folder_id || null); sets.push(`folder_id=$${args.length}`); }
  if ('color_tag' in b) {
    const t = ['red', 'orange', 'green', 'final'].includes(b.color_tag) ? b.color_tag : null;
    args.push(t); sets.push(`color_tag=$${args.length}`);
  }
  if (!sets.length) return json({ error: 'Nothing to change.' }, 400);
  args.push(params.id);
  const row = await one(`UPDATE items SET ${sets.join(',')} WHERE id=$${args.length} RETURNING id, filename, folder_id, color_tag`, args);
  return json({ item: row });
};

/**
 * Moves the image into the trash. `?purge=1` removes an image that is already in
 * the trash for good. With the trash switched off (trash_days = 0) a delete is
 * final straight away, as it used to be.
 */
export const DELETE: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const purge = url.searchParams.get('purge') === '1';
  const it = await loadItemFor(locals.user, params.id!, 'write', { includeTrashed: purge });
  if (!it) return json({ error: 'Not found.' }, 404);
  if (purge) {
    const gone = await purgeItems(locals.user, [it.id]);
    return json({ ok: gone.length === 1, purged: gone.length });
  }
  const moved = await trashItems(locals.user, [it.id]);
  return json({ ok: moved.length === 1, trashed: moved.length });
};
