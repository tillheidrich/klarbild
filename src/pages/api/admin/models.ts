import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';
import { listImageModels } from '../../../lib/openrouter';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// GET: the stored models; ?available=1 adds the ones OpenRouter offers.
export const GET: APIRoute = async ({ url }) => {
  if (!has('ai')) return moduleOff('ai');
  const models = await query('SELECT * FROM models ORDER BY sort, label');
  const out: any = { models };
  if (url.searchParams.get('available') === '1') {
    try {
      const avail = await listImageModels();
      out.available = avail.map((m: any) => ({
        model_id: m.id, name: m.name,
        supports_alpha: (m.supported_parameters?.background?.values || []).includes('transparent')
          || !!m.supported_parameters?.background,
      }));
    } catch (e: any) { out.available_error = e?.friendly || 'Could not fetch the model list.'; }
  }
  return json(out);
};

// POST: create/update a model (upsert by model_id) or run an action (toggle/default/delete).
export const POST: APIRoute = async ({ request }) => {
  if (!has('ai')) return moduleOff('ai');
  const b = await request.json();
  if (b.action === 'delete' && b.id) { await query('DELETE FROM models WHERE id=$1', [b.id]); return json({ ok: true }); }
  if (b.action === 'default' && b.id) {
    await query('UPDATE models SET is_default=false'); await query('UPDATE models SET is_default=true WHERE id=$1', [b.id]);
    return json({ ok: true });
  }
  if (b.action === 'nsfw' && b.id) {
    await query('UPDATE models SET nsfw = NOT nsfw WHERE id=$1', [b.id]);
    return json({ ok: true });
  }
  if (!b.model_id || !b.label) return json({ error: 'model_id and label are required.' }, 400);
  const existing = await one<{ id: string }>('SELECT id FROM models WHERE model_id=$1', [b.model_id]);
  if (existing) {
    await query(`UPDATE models SET label=$2, description=$3, active=$4, supports_alpha=$5, sort=$6 WHERE id=$1`,
      [existing.id, b.label, b.description || null, b.active ?? true, b.supports_alpha ?? false, b.sort ?? 0]);
    return json({ id: existing.id });
  }
  const row = await one(`INSERT INTO models (model_id, label, description, active, supports_alpha, sort)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.model_id, b.label, b.description || null, b.active ?? true, b.supports_alpha ?? false, b.sort ?? 0]);
  return json({ model: row });
};
