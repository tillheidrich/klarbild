import type { APIRoute } from 'astro';
import { loadConfig, testConnection } from '../../../lib/remotetarget';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async () => {
  if (!has('delivery')) return moduleOff('delivery');
  const cfg = await loadConfig();
  if (!cfg) return json({ ok: false, message: 'The delivery target is not fully configured.' });
  return json(await testConnection(cfg));
};
