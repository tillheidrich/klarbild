import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { one } from '../../../../lib/db';
import { getObject, putObject, sourceKey } from '../../../../lib/storage';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Copies an item's result into a new source, so it can be worked on further in
 *  the studio as a starting point. */
export const POST: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const it = await one<{ result_path: string | null; filename: string | null }>(
    'SELECT result_path, filename FROM items WHERE id=$1', [params.id]);
  if (!it?.result_path) return json({ error: 'There is no result.' }, 404);
  try {
    const buf = await getObject(it.result_path);
    const key = sourceKey(randomUUID(), 'png');
    await putObject(key, buf, 'image/png');
    const name = (it.filename || 'image').replace(/\.[^.]+$/, '') + '.png';
    return json({ source_path: key, filename: name });
  } catch (e: any) {
    return json({ error: e?.message || 'Could not load the result.' }, 500);
  }
};
