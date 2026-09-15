import type { APIRoute } from 'astro';
import { query, one } from '../../lib/db';
import { has, moduleOff } from '../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const rows = await query('SELECT * FROM recipes ORDER BY is_default DESC, name');
  return json({ recipes: rows });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
  const row = await one(
    `INSERT INTO recipes (name, tasks, output_format, orientation, crop_mode, dpi, contour_mm,
       model_key, delivery, delivery_folder, delivery_target_id, custom_instruction, mode, output_ext, is_default, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,$15) RETURNING *`,
    [b.name, JSON.stringify(b.tasks || []), b.output_format, b.orientation, b.crop_mode || 'crop',
     b.dpi || 300, b.contour_mm ?? null, b.model_key ?? null, b.delivery || 'library',
     b.delivery_folder ?? null, b.delivery_target_id ?? null, b.custom_instruction ?? null,
     ['each', 'compose', 'generate'].includes(b.mode) ? b.mode : 'each',
     (b.output_ext === 'jpg' || b.output_ext === 'png') ? b.output_ext : null, locals.user.uid]);
  return json({ recipe: row });
};
