import type { APIRoute } from 'astro';
import { query } from '../../../../lib/db';
import { has, moduleOff } from '../../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async () => {
  if (!has('telegram')) return moduleOff('telegram');
  const links = await query(`SELECT l.chat_id, l.active, l.linked_at, u.display_name AS user_name
    FROM telegram_links l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.linked_at DESC`);
  return json({ links });
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!has('telegram')) return moduleOff('telegram');
  const b = await request.json().catch(() => ({}));
  if (!b.chat_id) return json({ error: 'chat_id is required.' }, 400);
  await query('DELETE FROM telegram_links WHERE chat_id=$1', [b.chat_id]);
  return json({ ok: true });
};
