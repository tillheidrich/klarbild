import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const COLS = ['name', 'tasks', 'output_format', 'orientation', 'crop_mode', 'dpi', 'contour_mm',
  'model_key', 'delivery', 'delivery_folder', 'delivery_target_id', 'custom_instruction', 'mode', 'output_ext'];

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
  const sets: string[] = []; const args: any[] = [];
  const set = (c: string, v: any) => { args.push(v); sets.push(`${c}=$${args.length}`); };
  for (const c of COLS) {
    if (c in b) set(c, c === 'tasks' ? JSON.stringify(b[c] || []) : (b[c] === '' ? null : b[c]));
  }
  if (!sets.length) return json({ error: 'Nothing to change.' }, 400);
  args.push(params.id);
  const row = await one(`UPDATE recipes SET ${sets.join(',')} WHERE id=$${args.length} RETURNING *`, args);
  return json({ recipe: row });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  await query('DELETE FROM recipes WHERE id=$1', [params.id]);
  return json({ ok: true });
};
