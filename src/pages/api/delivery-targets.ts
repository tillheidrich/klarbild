import type { APIRoute } from 'astro';
import { query } from '../../lib/db';
import { has, moduleOff } from '../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Names of the extra targets for the studio dropdown (no credentials).
export const GET: APIRoute = async ({ locals }) => {
  if (!has('delivery')) return moduleOff('delivery');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const rows = await query('SELECT id, name FROM delivery_targets ORDER BY name');
  return json({ targets: rows });
};
