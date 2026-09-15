import type { APIRoute } from 'astro';
import { one, query } from '../../lib/db';
import { isEmail, mailReady } from '../../lib/mail';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const s = await one<{ private_allowed: boolean; share_default_days: number }>(
    'SELECT private_allowed, share_default_days FROM settings WHERE id=1');
  const u = await one<{ private_forced: boolean; email: string | null; notify_jobs: boolean; display_name: string | null; username: string }>(
    'SELECT private_forced, email, notify_jobs, display_name, username FROM users WHERE id=$1', [locals.user.uid]);
  return json({
    role: locals.user.role,
    private_allowed: !!s?.private_allowed,
    private_forced: !!u?.private_forced,
    // My account: email address and notifications
    username: u?.username ?? null,
    display_name: u?.display_name ?? null,
    email: u?.email ?? null,
    notify_jobs: !!u?.notify_jobs,
    mail_ready: await mailReady(),
    share_default_days: s?.share_default_days ?? 30,
  });
};

/** Maintain your own account: store an email address and switch notifications. */
export const PATCH: APIRoute = async ({ request, locals }) => {
  if (!locals.user?.uid) return new Response('Unauthorized', { status: 401 });
  const b = await request.json().catch(() => ({}));

  if ('email' in b) {
    const raw = String(b.email ?? '').trim().toLowerCase();
    if (raw && !isEmail(raw)) return json({ error: 'That does not look like a valid address.' }, 400);
    // The address is the way to reset a password — so it must not be handed out
    // twice.
    if (raw) {
      const taken = await one<{ id: string }>(
        'SELECT id FROM users WHERE lower(email)=$1 AND id<>$2', [raw, locals.user.uid]);
      if (taken) return json({ error: 'That address already belongs to another account.' }, 409);
    }
    try {
      await query('UPDATE users SET email=$2 WHERE id=$1', [locals.user.uid, raw || null]);
    } catch (e: any) {
      // Two simultaneous requests can slip past the check above — the unique
      // index catches it. Then give the same understandable answer as above
      // instead of an HTML error page.
      if (e?.code === '23505') return json({ error: 'That address already belongs to another account.' }, 409);
      throw e;
    }
  }

  if ('notify_jobs' in b) {
    await query('UPDATE users SET notify_jobs=$2 WHERE id=$1', [locals.user.uid, !!b.notify_jobs]);
  }
  return json({ ok: true });
};
