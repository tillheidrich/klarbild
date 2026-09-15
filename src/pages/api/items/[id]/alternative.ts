import type { APIRoute } from 'astro';
import { one, query } from '../../../../lib/db';
import { enqueue } from '../../../../lib/queue';
import { has, moduleOff } from '../../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Creates another take (an alternative) from the same source, with the same preset recipe. */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const item = await one<any>(
    `SELECT id, job_id, source_path, source_paths, filename, variant_of FROM items WHERE id=$1`, [params.id]);
  if (!item) return json({ error: 'Not found.' }, 404);
  // Without a source and without a model call there is nothing to vary.
  const root = item.variant_of || item.id;

  const it = await one<{ id: string }>(
    `INSERT INTO items (job_id, position, status, source_path, source_paths, filename, source_quality, variant_of)
     VALUES ($1, (SELECT COALESCE(max(position),0)+1 FROM items WHERE job_id=$1), 'queued', $2, $3, $4, 'original', $5)
     RETURNING id`,
    [item.job_id, item.source_path, item.source_paths ? JSON.stringify(item.source_paths) : null,
     item.filename, root]);
  // The job counts one more position and starts running again.
  await query(`UPDATE jobs SET total=total+1, status='queued', finished_at=NULL
               WHERE id=$1 AND status IN ('done','paused')`, [item.job_id]);
  await enqueue({ itemId: it!.id, jobId: item.job_id });
  return json({ ok: true, itemId: it!.id });
};
