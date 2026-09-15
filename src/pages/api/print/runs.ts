import type { APIRoute } from 'astro';
import { listRuns, deleteRun } from '../../../lib/printruns';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most recent prints — the settings and the sources, never the PDF itself. */
export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const limit = Number(url.searchParams.get('limit')) || 30;
  const runs = await listRuns(locals.user.uid, locals.user.role === 'admin', limit);
  return json({ runs });
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const id = url.searchParams.get('id') || '';
  if (!UUID.test(id)) return json({ error: 'Unknown entry.' }, 404);
  const ok = await deleteRun(id, locals.user.uid, locals.user.role === 'admin');
  return ok ? json({ ok: true }) : json({ error: 'Unknown entry.' }, 404);
};
