import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';
import { updateShare, revokeShare, unrevokeShare, deleteShare } from '../../../lib/shares';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The most recent views of a link — for the report in the frontend. */
export const GET: APIRoute = async ({ params, locals }) => {
  if (!has('share')) return moduleOff('share');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  if (!UUID.test(params.id || '')) return json({ error: 'Unknown link.' }, 404);
  const isAdmin = locals.user.role === 'admin';
  const rows = await query<any>(
    `SELECT v.kind, v.at, v.user_agent
       FROM share_views v JOIN shares s ON s.id = v.share_id
      WHERE v.share_id = $1 AND ($3::boolean OR s.created_by = $2)
      ORDER BY v.at DESC LIMIT 100`, [params.id, locals.user.uid, isAdmin]);
  return json({ visits: rows });
};

/** Change the title, expiry, passphrase or download permission; revoke or release. */
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!has('share')) return moduleOff('share');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  if (!UUID.test(params.id || '')) return json({ error: 'Unknown link.' }, 404);
  const b = await request.json().catch(() => ({}));
  const isAdmin = locals.user.role === 'admin';

  if (b.action === 'revoke') {
    return json({ ok: await revokeShare(params.id!, locals.user.uid, isAdmin) });
  }
  if (b.action === 'unrevoke') {
    return json({ ok: await unrevokeShare(params.id!, locals.user.uid, isAdmin) });
  }
  const ok = await updateShare(params.id!, locals.user.uid, isAdmin, {
    title: b.title, note: b.note, days: b.days,
    allowDownload: b.allowDownload, password: b.password,
  });
  return ok ? json({ ok: true }) : json({ error: 'Unknown link.' }, 404);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!has('share')) return moduleOff('share');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  if (!UUID.test(params.id || '')) return json({ error: 'Unknown link.' }, 404);
  const ok = await deleteShare(params.id!, locals.user.uid, locals.user.role === 'admin');
  return ok ? json({ ok: true }) : json({ error: 'Unknown link.' }, 404);
};
