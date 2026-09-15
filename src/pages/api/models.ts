import type { APIRoute } from 'astro';
import { one, query } from '../../lib/db';
import { has, moduleOff } from '../../lib/modules';

export const prerender = false;

// Active models with friendly names (for the studio picker and the result view).
// NSFW-capable models only if allow_nsfw is switched on in the settings.
export const GET: APIRoute = async ({ locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const s = await one<{ allow_nsfw: boolean }>('SELECT allow_nsfw FROM settings WHERE id=1');
  const models = await query(
    `SELECT model_id, label, description, is_default, supports_alpha, nsfw FROM models
     WHERE active AND (nsfw=false OR $1=true) ORDER BY sort, label`, [!!s?.allow_nsfw]);
  return new Response(JSON.stringify({ models }), { headers: { 'Content-Type': 'application/json' } });
};
