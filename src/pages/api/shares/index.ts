import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';
import { createShare, listShares, MAX_ITEMS } from '../../../lib/shares';
import { has, moduleOff } from '../../../lib/modules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** List your own share links (admins see all of them). */
export const GET: APIRoute = async ({ locals }) => {
  if (!has('share')) return moduleOff('share');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const shares = await listShares(locals.user.uid, locals.user.role === 'admin');
  return json({ shares });
};

/**
 * Create a new link.
 * Only images you are allowed to see may be shared — otherwise the share button
 * would be a comfortable way around the visibility rule.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!has('share')) return moduleOff('share');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.itemIds) ? b.itemIds.filter((x: any) => typeof x === 'string') : [];
  if (!ids.length) return json({ error: 'No images selected.' }, 400);
  if (ids.length > MAX_ITEMS) return json({ error: `At most ${MAX_ITEMS} images per link.` }, 422);

  // Check the ids first — an invalid one would otherwise make Postgres abort with
  // "invalid input syntax for type uuid" and the caller would get a 500 instead
  // of a clear answer.
  if (ids.some((id) => !UUID.test(id))) return json({ error: 'Invalid image id.' }, 400);

  const isAdmin = locals.user.role === 'admin';
  // One query instead of one per image: with 500 images that was 500 round trips.
  const found = await query<{ id: string; status: string; result_path: string | null; created_by: string | null; private: boolean; library_visibility: string }>(
    `SELECT i.id, i.status, i.result_path, j.created_by, j.private,
            (SELECT library_visibility FROM settings WHERE id=1) AS library_visibility
       FROM items i JOIN jobs j ON j.id = i.job_id
      WHERE i.id = ANY($1::uuid[])`, [ids]);
  if (found.length !== ids.length) return json({ error: 'One of the images is no longer available.' }, 404);

  for (const it of found) {
    if (!it.result_path || it.status !== 'done') return json({ error: 'One of the images is no longer available.' }, 404);
    // Private jobs are deliberately never shared — the whole point is that they
    // leave no trace.
    if (it.private) return json({ error: 'Images from private sessions cannot be shared.' }, 403);
    const own = it.created_by === locals.user.uid;
    if (!isAdmin && !own && it.library_visibility !== 'shared')
      return json({ error: 'No access to one of the images.' }, 403);
  }

  try {
    const share = await createShare({
      itemIds: ids,
      kind: b.kind === 'collection' ? 'collection' : undefined,
      title: b.title, note: b.note,
      days: b.days, allowDownload: b.allowDownload, password: b.password,
      userId: locals.user.uid,
    });
    return json({ share });
  } catch (e: any) {
    // Pass on our own messages (validity, empty selection), not database
    // internals — those give away table and column names.
    const own = /Validity|selected|images per link/.test(String(e?.message || ''));
    if (!own) console.error('[shares] creating failed:', e?.message || e);
    return json({ error: own ? e.message : 'The link could not be created.' }, 400);
  }
};
