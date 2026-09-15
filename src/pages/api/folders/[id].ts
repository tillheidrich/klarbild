import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
  const row = await one(`UPDATE folders SET name=COALESCE($2,name), delivery_folder=$3 WHERE id=$1 RETURNING *`,
    [params.id, b.name?.trim() || null, b.delivery_folder ?? null]);
  return json({ folder: row });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  await query('DELETE FROM folders WHERE id=$1', [params.id]);
  return json({ ok: true });
};
