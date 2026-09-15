import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const rows = await query(`SELECT f.*, (SELECT count(*) FROM items WHERE folder_id=f.id)::int AS count
                            FROM folders f ORDER BY f.name`);
  return json({ folders: rows });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
  if (!b.name?.trim()) return json({ error: 'Name is missing.' }, 400);
  const row = await one(`INSERT INTO folders (name, delivery_folder) VALUES ($1,$2) RETURNING *`,
    [b.name.trim(), b.delivery_folder || null]);
  return json({ folder: row });
};

// Rename a folder / change the folder on the target. Body { id, name?, delivery_folder? }
export const PATCH: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
  if (!b.id) return json({ error: 'No id.' }, 400);
  const sets: string[] = []; const args: any[] = [];
  if (typeof b.name === 'string' && b.name.trim()) { args.push(b.name.trim()); sets.push(`name=$${args.length}`); }
  if ('delivery_folder' in b) { args.push(b.delivery_folder?.trim() || null); sets.push(`delivery_folder=$${args.length}`); }
  if (!sets.length) return json({ error: 'Nothing to change.' }, 400);
  args.push(b.id);
  const row = await one(`UPDATE folders SET ${sets.join(',')} WHERE id=$${args.length} RETURNING *`, args);
  return json({ folder: row });
};

// Delete a folder (the images stay, they only lose the assignment). ?id=…
export const DELETE: APIRoute = async ({ request, url, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  let id = url.searchParams.get('id');
  if (!id) { try { id = (await request.json())?.id; } catch { /* no matter */ } }
  if (!id) return json({ error: 'No id.' }, 400);
  await query('DELETE FROM folders WHERE id=$1', [id]);
  return json({ ok: true });
};
