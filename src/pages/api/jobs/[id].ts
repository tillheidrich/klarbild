import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ params, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const job = await one<any>('SELECT * FROM jobs WHERE id=$1', [params.id]);
  if (!job) return json({ error: 'Not found.' }, 404);
  // Access: your own job, an admin, or a shared (non-private) one.
  const isAdmin = locals.user.role === 'admin';
  const own = job.created_by === locals.user.uid;
  if (!isAdmin && !own) {
    const s = await one<{ library_visibility: string }>('SELECT library_visibility FROM settings WHERE id=1');
    if (job.private || s?.library_visibility !== 'shared') return new Response('Forbidden', { status: 403 });
  }
  const items = await query(
    `SELECT id, position, status, filename, output_px, has_alpha, error_message,
            result_path, delivery_status, cost FROM items WHERE job_id=$1 ORDER BY position`,
    [params.id]);
  return json({ job, items });
};
