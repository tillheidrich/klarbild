import type { APIRoute } from 'astro';
import { login, makeSessionCookie, rateLimited, noteFailure, clearFailures } from '../../../lib/auth';
import { realIp, tooOften } from '../../../lib/limit';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Not `clientAddress` directly: that is the **first** value out of
  // X-Forwarded-For and therefore set by the caller itself — the lock after
  // five failed attempts could otherwise be sidestepped with a changing header.
  const ip = realIp(request, clientAddress);
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Please try again in 15 minutes.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } });
  }
  let username = '', password = '';
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const b = await request.json().catch(() => ({}));
    username = b.username || ''; password = b.password || '';
  } else {
    const f = await request.formData();
    username = String(f.get('username') || ''); password = String(f.get('password') || '');
  }

  // Count per user name as well — otherwise the per-IP lock does nothing when
  // the attacker comes from many networks.
  if (tooOften('login-user:' + username.trim().toLowerCase(), 10, 15 * 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Please try again in 15 minutes.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } });
  }

  const session = await login(username.trim(), password);
  if (!session) {
    noteFailure(ip);
    return new Response(JSON.stringify({ error: 'Wrong user name or password.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  clearFailures(ip);
  return new Response(JSON.stringify({ ok: true, role: session.user.role }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeSessionCookie(session.user, session.epoch) },
  });
};
