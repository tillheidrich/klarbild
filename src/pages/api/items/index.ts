import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// The library with filters: ?task=&format=&folder=&delivery=&by=
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const q = url.searchParams;
  const s = await one<any>('SELECT library_visibility, anonymous_generations FROM settings WHERE id=1');
  const isAdmin = locals.user.role === 'admin';
  const shared = s?.library_visibility === 'shared';
  // Private jobs never show up in the library; visibility follows the setting.
  const where: string[] = [`i.status='done'`, `j.private=false`];
  const args: any[] = [];
  const add = (cond: string, val: any) => { args.push(val); where.push(cond.replace('?', `$${args.length}`)); };
  if (!isAdmin && !shared) add('j.created_by = ?', locals.user.uid);

  if (q.get('folder')) add('i.folder_id = ?', q.get('folder'));
  if (q.get('tag')) add('i.color_tag = ?', q.get('tag'));
  if (q.get('delivery')) add('i.delivery_status = ?', q.get('delivery'));
  if (q.get('by')) add('j.created_by = ?', q.get('by'));
  if (q.get('format')) add('i.output_px = ?', q.get('format'));
  if (q.get('task')) {
    args.push(JSON.stringify([q.get('task')]));
    where.push(`j.recipe_snapshot->'tasks' @> $${args.length}::jsonb`);
  }

  const rows = await query(
    `SELECT i.id, i.filename, i.output_px, i.has_alpha, i.result_path, i.thumb_path, i.folder_id, i.color_tag,
            i.delivery_status, i.mirror_status, i.prompt_used, i.created_at, i.model_used, i.variant_of, j.mode,
            ${(s?.anonymous_generations && !isAdmin) ? 'NULL' : 'u.display_name'} AS by_name,
            j.recipe_snapshot->'tasks' AS tasks
       FROM items i
       JOIN jobs j ON j.id = i.job_id
       LEFT JOIN users u ON u.id = j.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY i.created_at DESC LIMIT 400`, args);
  return json({ items: rows });
};
