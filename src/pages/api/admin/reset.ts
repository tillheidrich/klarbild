import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';
import { deleteObject } from '../../../lib/storage';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Resets the content: deletes all images, jobs and folders plus their files.
 *  Users, settings, models and preset recipes are kept.
 *  Requires { confirm: 'RESET' }. */
export const POST: APIRoute = async ({ request, locals }) => {
  if (locals.user?.role !== 'admin') return new Response('Forbidden', { status: 403 });
  const b = await request.json().catch(() => ({} as any));
  if (b.confirm !== 'RESET') return json({ error: 'Confirmation is missing (confirm=RESET).' }, 400);

  // Remove every object from storage first.
  const items = await query<any>('SELECT source_path, source_paths, result_path, thumb_path FROM items');
  let objects = 0;
  for (const it of items) {
    const keys = [it.source_path, it.result_path, it.thumb_path,
      ...((it.source_paths as string[]) || [])].filter(Boolean);
    for (const k of keys) { await deleteObject(k).catch(() => {}); objects++; }
  }

  // Empty the content tables (the configuration stays).
  await query('DELETE FROM print_job_items');
  await query('DELETE FROM print_jobs');
  await query('DELETE FROM share_links');
  await query('DELETE FROM telegram_drafts');
  await query('DELETE FROM items');
  await query('DELETE FROM jobs');
  await query('DELETE FROM folders');

  return json({ ok: true, deleted_items: items.length, deleted_objects: objects });
};
