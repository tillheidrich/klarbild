import type { APIRoute } from 'astro';
import { one, query } from '../../../../lib/db';
import { enqueue } from '../../../../lib/queue';
import { has, moduleOff } from '../../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ params, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const item = await one<{ id: string; job_id: string }>(
    'SELECT id, job_id FROM items WHERE id=$1', [params.id]);
  if (!item) return json({ error: 'Not found.' }, 404);
  await query(`UPDATE items SET status='queued', error_message=NULL WHERE id=$1`, [item.id]);
  await query(`UPDATE jobs SET status='queued' WHERE id=$1 AND status IN ('done','paused')`, [item.job_id]);
  await enqueue({ itemId: item.id, jobId: item.job_id });
  return json({ ok: true });
};
