import type { APIRoute } from 'astro';
import { loadMirrorConfig, testMirror } from '../../../lib/mirror';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async () => {
  if (!has('mirror')) return moduleOff('mirror');
  const cfg = await loadMirrorConfig();
  if (!cfg) return json({ ok: false, message: 'The backup mirror is not fully configured (or switched off).' });
  return json(await testMirror(cfg));
};
