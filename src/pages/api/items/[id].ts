import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';
import { deleteObject } from '../../../lib/storage';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
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

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const it = await one<{ result_path: string | null }>('SELECT result_path FROM items WHERE id=$1', [params.id]);
  if (it?.result_path) await deleteObject(it.result_path).catch(() => {});
  await query('DELETE FROM items WHERE id=$1', [params.id]);
  return json({ ok: true });
};
