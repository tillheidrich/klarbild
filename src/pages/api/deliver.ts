import type { APIRoute } from 'astro';
import { deliverItem } from '../../lib/delivery';
import { has, moduleOff } from '../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Body: { itemIds: [...] } — send a selection to the delivery target after the fact.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!has('delivery')) return moduleOff('delivery');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
  const ids: string[] = b.itemIds || [];
  if (!ids.length) return json({ error: 'Nothing selected.' }, 400);
  const results = [];
  for (const id of ids) results.push({ id, ...(await deliverItem(id)) });
  const ok = results.filter((r) => r.ok).length;
  return json({ delivered: ok, total: ids.length, results });
};
