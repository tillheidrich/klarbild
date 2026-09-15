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
  const id = params.id!;
  const job = await one<{ id: string }>('SELECT id FROM jobs WHERE id=$1', [id]);
  if (!job) return json({ error: 'Not found.' }, 404);

  switch (params.action) {
    case 'pause':
      await query(`UPDATE jobs SET status='paused' WHERE id=$1`, [id]);
      break;
    case 'resume': {
      await query(`UPDATE jobs SET status='queued' WHERE id=$1`, [id]);
      const items = await query<{ id: string }>(
        `SELECT id FROM items WHERE job_id=$1 AND status IN ('queued','running')`, [id]);
      for (const it of items) await enqueue({ itemId: it.id, jobId: id });
      break;
    }
    case 'cancel':
      await query(`UPDATE jobs SET status='cancelled', finished_at=now() WHERE id=$1`, [id]);
      await query(`UPDATE items SET status='skipped' WHERE job_id=$1 AND status IN ('queued','running')`, [id]);
      break;
    case 'retry-failed': {
      const items = await query<{ id: string }>(
        `UPDATE items SET status='queued', error_message=NULL WHERE job_id=$1 AND status='failed' RETURNING id`, [id]);
      await query(`UPDATE jobs SET status='queued', failed_count=0 WHERE id=$1`, [id]);
      for (const it of items) await enqueue({ itemId: it.id, jobId: id });
      break;
    }
    case 'delete': {
      // Remove the job with its positions and their objects (for old or failed jobs).
      const { deleteObject } = await import('../../../../lib/storage');
      const items = await query<any>(
        `SELECT source_path, source_paths, result_path, thumb_path FROM items WHERE job_id=$1`, [id]);
      for (const it of items) {
        const keys = [it.source_path, it.result_path, it.thumb_path, ...((it.source_paths as string[]) || [])].filter(Boolean);
        for (const k of keys) await deleteObject(k).catch(() => {});
      }
      await query(`DELETE FROM items WHERE job_id=$1`, [id]);
      await query(`DELETE FROM jobs WHERE id=$1`, [id]);
      break;
    }
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
  return json({ ok: true });
};
