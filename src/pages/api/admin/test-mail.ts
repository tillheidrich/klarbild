import type { APIRoute } from 'astro';
import { testMail, sendMail, mailLayout, isEmail } from '../../../lib/mail';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/**
 * Without `to`: only check the connection (nothing is sent).
 * With `to`: send a real test message — only that proves the mail actually
 * arrives and does not end up in the spam folder.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!has('mail')) return moduleOff('mail');
  const b = await request.json().catch(() => ({}));
  const to = String(b.to || '').trim();
  if (!to) return json(await testMail());
  if (!isEmail(to)) return json({ ok: false, message: 'That is not a valid address.' }, 400);
  try {
    await sendMail({
      to,
      subject: 'Klarbild — test message',
      text: 'If you are reading this, sending mail from Klarbild works.\n\n'
        + 'Which means these now work: password resets, notices about finished jobs, and share links by mail.',
      html: mailLayout('Sending works', [
        'If you are reading this, mail from your Klarbild installation arrives.',
        'Which means these now work: resetting a password, notices about finished jobs, and share links by mail.',
      ]),
    });
    return json({ ok: true, message: `Test message sent to ${to}. Check the spam folder too.` });
  } catch (e: any) {
    console.error('[test-mail]', e?.message || e);
    return json({ ok: false, message: 'Sending failed — check the credentials and the port.' });
  }
};
