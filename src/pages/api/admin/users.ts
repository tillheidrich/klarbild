import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';
import { hashPassword, bumpSessionEpoch } from '../../../lib/auth';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async () => {
  const users = await query('SELECT id, username, role, display_name, private_forced, created_at FROM users ORDER BY username');
  return json({ users });
};

// POST: create a new user OR set a password/attribute (when username or id already exists).
export const POST: APIRoute = async ({ request }) => {
  const b = await request.json();
  if (b.id && b.password) {
    await query('UPDATE users SET password_hash=$2 WHERE id=$1', [b.id, await hashPassword(b.password)]);
    // A new password means old sessions no longer count.
    await bumpSessionEpoch(b.id);
    return json({ ok: true });
  }
  if (b.id && 'private_forced' in b) {
    await query('UPDATE users SET private_forced=$2 WHERE id=$1', [b.id, !!b.private_forced]);
    return json({ ok: true });
  }
  if (b.id && b.role) {
    await query(`UPDATE users SET role=$2 WHERE id=$1`, [b.id, b.role === 'admin' ? 'admin' : 'user']);
    // Role changed, so invalidate the session: otherwise a demoted admin would
    // keep their rights until the cookie expires.
    await bumpSessionEpoch(b.id);
    return json({ ok: true });
  }
  if (!b.username || !b.password) return json({ error: 'username and password are required.' }, 400);
  const exists = await one('SELECT id FROM users WHERE username=$1', [b.username.trim()]);
  if (exists) return json({ error: 'That user name is taken.' }, 400);
  const row = await one(`INSERT INTO users (username, role, display_name, password_hash)
    VALUES ($1,$2,$3,$4) RETURNING id, username, role, display_name`,
    [b.username.trim(), b.role === 'admin' ? 'admin' : 'user', b.display_name || b.username.trim(), await hashPassword(b.password)]);
  return json({ user: row });
};
