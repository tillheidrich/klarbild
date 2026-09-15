import type { APIRoute } from 'astro';
import { one } from '../../../../lib/db';
import { has, moduleOff } from '../../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Creates a six-digit pairing code (valid for 15 minutes) for a user.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!has('telegram')) return moduleOff('telegram');
  const b = await request.json().catch(() => ({}));
  const userId = b.userId || locals.user?.uid;
  if (!userId) return json({ error: 'userId is required.' }, 400);
  // Six-digit code (Math.random is fine here — no cryptographic secret, and short-lived)
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await one(`INSERT INTO telegram_pairing_codes (code, user_id, expires_at)
             VALUES ($1,$2, now() + interval '15 minutes')
             ON CONFLICT (code) DO UPDATE SET user_id=$2, expires_at=now()+interval '15 minutes', used_at=NULL`,
    [code, userId]);
  return json({ code, expires_minutes: 15 });
};
