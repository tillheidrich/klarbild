// Sending email through your own mailbox provider (SMTP).
//
// Deliberately through the existing outgoing mail server instead of a sending
// service: the domain sits there anyway, so SPF and DKIM are right by
// themselves, and no further provider comes into play that would get to see the
// mails.
//
// The credentials sit encrypted in `settings` (AES-256-GCM, like the OpenRouter
// key and the delivery target password) and **never** in the repository.
import nodemailer from 'nodemailer';
import { one } from './db.ts';
import { decrypt } from './crypto.ts';

export interface MailCfg {
  host: string; port: number; secure: boolean;
  user: string; password: string; from: string;
}

export interface MailSource { cfg: MailCfg; source: 'database' | 'environment' }

/**
 * SMTP credentials — from the settings first, otherwise from the environment.
 *
 * The same order of precedence as for the OpenRouter key: whatever someone
 * enters in the admin area wins. The environment variables are the starting
 * value, so that sending works right after a fresh setup without anyone having
 * to type credentials in — and so that the password sits **only** there and in
 * the encrypted column, never in the repository.
 */
export async function loadMailSource(): Promise<MailSource | null> {
  const s = await one<any>(
    `SELECT smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from FROM settings WHERE id=1`);

  if (s?.smtp_host && s?.smtp_user && s?.smtp_password) {
    try {
      return { source: 'database', cfg: {
        host: s.smtp_host,
        port: Number(s.smtp_port) || 465,
        secure: s.smtp_secure !== false,
        user: s.smtp_user,
        password: decrypt(s.smtp_password),
        from: s.smtp_from || s.smtp_user,
      } };
    } catch {
      // Decryption failed (after a change of the ENCRYPTION_KEY, for example) —
      // then the environment is better than nothing.
      console.error('[mail] Stored password not readable, falling back to the environment.');
    }
  }

  const e = process.env;
  if (e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASSWORD) {
    return { source: 'environment', cfg: {
      host: e.SMTP_HOST,
      port: Number(e.SMTP_PORT) || 465,
      secure: e.SMTP_SECURE !== 'false',
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      from: e.SMTP_FROM || e.SMTP_USER,
    } };
  }
  return null;
}

/** Only the credentials, without where they came from. */
export async function loadMailConfig(): Promise<MailCfg | null> {
  return (await loadMailSource())?.cfg ?? null;
}

export const mailReady = async (): Promise<boolean> => !!(await loadMailConfig());

export interface MailInput {
  to: string;
  subject: string;
  /** Body text. Is sent as the plain-text version as well. */
  text: string;
  /** Optional HTML body; without one the text is simply framed. */
  html?: string;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A plain, readable HTML frame. No external images, no tracking pixels, no
 * fonts from someone else's servers — that would be blocked in many mailboxes
 * anyway and would be impolite towards the recipient.
 */
export function mailLayout(title: string, paragraphs: string[], button?: { text: string; url: string }): string {
  const p = paragraphs.map((a) => `<p style="margin:0 0 14px;line-height:1.6">${a}</p>`).join('');
  const btn = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#1B3BE0;color:#fff;
         text-decoration:none;padding:12px 20px;border-radius:4px;font-weight:600">${esc(button.text)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#6A685D">If the button does not work:<br>
         <a href="${esc(button.url)}" style="color:#1B3BE0;word-break:break-all">${esc(button.url)}</a></p>`
    : '';
  return `<!doctype html><html lang="en"><body style="margin:0;background:#EAEAE3;padding:24px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16150F;font-size:15px">
  <div style="max-width:560px;margin:0 auto;background:#FBFBF7;border:1px solid #D7D6CC;border-radius:4px;padding:28px">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6A685D;margin-bottom:18px">Klarbild</div>
    <h1 style="font-size:20px;margin:0 0 16px;line-height:1.3">${esc(title)}</h1>
    ${p}${btn}
  </div>
  <div style="max-width:560px;margin:14px auto 0;font-size:12px;color:#6A685D;text-align:center">
    This message comes from your own Klarbild installation.
  </div></body></html>`;
}

/**
 * Sends a mail. Throws if no credentials are configured — the callers decide
 * whether that is an error or only a notice.
 */
export async function sendMail(m: MailInput): Promise<void> {
  const cfg = await loadMailConfig();
  if (!cfg) throw new Error('No email credentials configured.');
  const tx = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    // No endless hanging when the server does not answer.
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  try {
    await tx.sendMail({
      from: cfg.from, to: m.to, subject: m.subject,
      text: m.text,
      html: m.html || mailLayout(m.subject, m.text.split('\n\n').map(esc)),
    });
  } finally {
    tx.close();
  }
}

/** Like `sendMail`, but reports errors only into the log. For notifications. */
export async function trySendMail(m: MailInput): Promise<boolean> {
  try { await sendMail(m); return true; }
  catch (e: any) { console.error('[mail] sending failed:', e?.message || e); return false; }
}

/** Check the connection without sending anything — for the test button in the admin area. */
export async function testMail(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadMailConfig();
  if (!cfg) return { ok: false, message: 'No email credentials configured.' };
  const tx = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: 15000, greetingTimeout: 10000,
  });
  try {
    await tx.verify();
    return { ok: true, message: `Connection to ${cfg.host}:${cfg.port} succeeded.` };
  } catch (e: any) {
    // Provider messages can contain the user name — keep it short.
    const raw = String(e?.message || e);
    const short = /auth/i.test(raw) ? 'Sign-in refused — check the user name or the password.'
      : /timeout|ETIMEDOUT|ECONNREFUSED/i.test(raw) ? 'Server not reachable — check the host and the port.'
      : /certificate|self.signed/i.test(raw) ? 'Certificate error — check the encryption (port 465 = SSL, 587 = STARTTLS).'
      : 'Connection failed.';
    return { ok: false, message: short };
  } finally {
    tx.close();
  }
}

/**
 * A rough plausibility check of an address.
 *
 * Control characters are checked against the **raw** value, not the trimmed
 * one: in JavaScript `$` without the `m` flag also matches in front of a
 * trailing line break, and `trim()` would take it away anyway. The two together
 * would have let `"a@b.de\n"` through — and that is exactly how every header
 * injection starts.
 */
export const isEmail = (v: string): boolean => {
  const raw = String(v ?? '');
  if (/[\r\n\t\0]/.test(raw)) return false;
  const s = raw.trim();
  return !!s && s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s);
};
