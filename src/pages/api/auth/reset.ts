import type { APIRoute } from 'astro';
import { randomBytes, createHash } from 'node:crypto';
import { one, query } from '../../../lib/db';
import { hashPassword, bumpSessionEpoch } from '../../../lib/auth';
import { sendMail, mailLayout, mailReady, isEmail, esc } from '../../../lib/mail';
import { tooOften, realIp } from '../../../lib/limit';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const VALID_MINUTES = 60;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const baseUrl = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

/**
 * Request a reset link (`{ email }`) or set a new password
 * (`{ token, password }`).
 *
 * Important: when a link is requested the route **always answers the same way**,
 * whether or not the address exists. Otherwise it would be possible to read off
 * who has an account.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!has('mail')) return moduleOff('mail');
  const ip = realIp(request, clientAddress);
  const b = await request.json().catch(() => ({}));

  // --- Set a new password ----------------------------------------------------
  if (b.token) {
    const token = String(b.token);
    const pw = String(b.password || '');
    if (pw.length < 10) return json({ error: 'The password must be at least 10 characters long.' }, 400);
    if (tooOften('reset-redeem:' + ip, 20, 15 * 60_000)) return json({ error: 'Too many attempts. Please try again later.' }, 429);

    const r = await one<{ user_id: string }>(
      `SELECT user_id FROM password_resets
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [hashToken(token)]);
    if (!r) return json({ error: 'This link has expired or has already been used.' }, 400);

    await query('UPDATE users SET password_hash=$2 WHERE id=$1', [r.user_id, await hashPassword(pw)]);
    // Single use, and every other open link for the same account expires with it.
    await query('UPDATE password_resets SET used_at = now() WHERE user_id=$1 AND used_at IS NULL', [r.user_id]);
    // The decisive part: **invalidate every existing session**. Someone who
    // resets their password usually does so because someone else got in — without
    // this step that person's cookie would stay valid for up to 30 days and the
    // whole exercise would have no effect.
    await bumpSessionEpoch(r.user_id);
    return json({ ok: true });
  }

  // --- Request a reset link --------------------------------------------------
  const email = String(b.email || '').trim().toLowerCase();
  if (!isEmail(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  // Two limits: per sender **and** per target address. Without the second one a
  // particular mailbox could be flooded from changing addresses — at the cost of
  // your own domain's deliverability.
  if (tooOften('reset-ip:' + ip, 5, 15 * 60_000)) return json({ ok: true });
  if (tooOften('reset-mail:' + email, 3, 60 * 60_000)) return json({ ok: true });
  if (!(await mailReady())) return json({ error: 'This server has no outgoing mail configured.' }, 503);

  const u = await one<{ id: string; display_name: string | null; username: string }>(
    'SELECT id, display_name, username FROM users WHERE lower(email) = $1', [email]);

  if (u) {
    const token = randomBytes(32).toString('base64url');
    await query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [hashToken(token), u.id, String(VALID_MINUTES)]);

    const url = `${baseUrl()}/password?token=${token}`;
    const name = u.display_name || u.username;
    // Do not await: an SMTP send takes hundreds of milliseconds. If the response
    // waited for it, the timing alone would reveal whether the account exists —
    // and the identical answer below would be worthless.
    void sendMail({
      to: email,
      subject: 'Reset your Klarbild password',
      text: `Hello ${name},\n\nuse the link below to set a new password for Klarbild. `
        + `The link is valid for ${VALID_MINUTES} minutes and can only be used once.\n\n${url}\n\n`
        + `If you did not ask for this, you can ignore this message — nothing will change.`,
      html: mailLayout('Set a new password', [
        `Hello ${esc(name)},`,
        `use the button below to set a new password for Klarbild. The link is valid for <b>${VALID_MINUTES} minutes</b> and can only be used <b>once</b>.`,
        `If you did not ask for this, you can ignore this message — nothing will change.`,
      ], { text: 'Set a new password', url }),
    }).catch((e) => console.error('[reset] mail failed:', e?.message || e));
  }

  // Always the same answer — otherwise it would reveal which addresses have an account.
  return json({ ok: true });
};
