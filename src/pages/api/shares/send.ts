import type { APIRoute } from 'astro';
import { one } from '../../../lib/db';
import { sendMail, mailLayout, mailReady, isEmail, esc } from '../../../lib/mail';
import { tooOften } from '../../../lib/limit';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const baseUrl = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const MAX_RECIPIENTS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Send a share link by email.
 *
 * Deliberately **without an image attachment**: a poster at full resolution
 * bursts any mailbox, and an attachment cannot be withdrawn afterwards. A link
 * can be — it has an expiry date and can be switched off at any time.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!has('share')) return moduleOff('share');
  if (!has('mail')) return moduleOff('mail');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json().catch(() => ({}));

  const recipients: string[] = (Array.isArray(b.to) ? b.to : String(b.to || '').split(/[,;\s]+/))
    .map((x: string) => String(x).trim().toLowerCase()).filter(Boolean);
  if (!recipients.length) return json({ error: 'No recipient address given.' }, 400);
  if (recipients.length > MAX_RECIPIENTS) return json({ error: `At most ${MAX_RECIPIENTS} recipients at once.` }, 422);
  const bad = recipients.filter((e) => !isEmail(e));
  if (bad.length) return json({ error: `Not a valid address: ${bad[0]}` }, 400);

  if (!(await mailReady())) return json({ error: 'No outgoing mail is configured (Admin → Email).' }, 503);
  // Without an absolute base address the mail would contain a relative path that
  // no mailbox makes clickable — then it is better not to send at all.
  if (!/^https?:\/\//.test(baseUrl()))
    return json({ error: 'The base address of the server is missing (PUBLIC_BASE_URL) — the link in the mail would be useless.' }, 503);

  // Limit per sender, not per IP: whoever is signed in is identified.
  if (tooOften('mailversand:' + locals.user.uid, 50, 60 * 60_000))
    return json({ error: 'Enough has been sent for this hour. Please carry on later.' }, 429);

  if (!UUID.test(String(b.shareId || ''))) return json({ error: 'Unknown link.' }, 404);

  const isAdmin = locals.user.role === 'admin';
  const share = await one<any>(
    `SELECT s.*, (SELECT count(*)::int FROM share_items si WHERE si.share_id = s.id) AS item_count
       FROM shares s WHERE s.id = $1 AND ($3::boolean OR s.created_by = $2)`,
    [b.shareId, locals.user.uid, isAdmin]);
  if (!share) return json({ error: 'Unknown link.' }, 404);
  if (share.revoked_at) return json({ error: 'This link is switched off — release it again first.' }, 409);
  // The expiry counts too: otherwise grandma gets a mail pointing at a page that
  // tells her "This link has expired".
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now())
    return json({ error: 'This link has expired — extend its validity first.' }, 409);

  const url = `${baseUrl()}/s/${share.slug}`;
  const sender = locals.user.name || locals.user.username || 'Someone';
  const title = share.title || (share.item_count > 1 ? `${share.item_count} images` : 'An image');
  const message = String(b.message || '').trim().slice(0, 1000);
  const validity = share.expires_at
    ? `The link is valid until ${new Date(share.expires_at).toLocaleDateString('en-GB')}.`
    : 'The link does not expire.';
  const passphrase = share.password_hash
    ? 'To open it you also need the passphrase — you will get that separately.'
    : '';

  // `mailLayout` deliberately puts paragraphs into the HTML raw so that <b>
  // works — everything that comes from user input therefore has to be escaped
  // **here**. Previously only the message was escaped, not the title: that made
  // it possible to send a foreign link in familiar clothing through our own mail
  // server, signed with SPF and DKIM.
  const paragraphs = [
    `${esc(sender)} has sent you something via Klarbild: <b>${esc(title)}</b>.`,
    ...(message ? [esc(message).replace(/\n/g, '<br>')] : []),
    [validity, passphrase].filter(Boolean).join(' '),
  ];

  let ok = 0; const failed: string[] = [];
  for (const to of recipients) {
    try {
      await sendMail({
        to,
        subject: `${sender} shares: ${title}`,
        text: `${sender} has sent you something via Klarbild: ${title}.\n\n`
          + (message ? `${message}\n\n` : '')
          + `${url}\n\n${validity}${passphrase ? ' ' + passphrase : ''}`,
        html: mailLayout(title, paragraphs, { text: 'View the images', url }),
      });
      ok++;
    } catch (e: any) {
      console.error('[share/send] to', to, 'failed:', e?.message || e);
      failed.push(to);
    }
  }
  return json({ ok, failed, url });
};
