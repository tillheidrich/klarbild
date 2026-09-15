// Share links: make one image or a collection publicly reachable without the
// recipient needing an account.
//
// Ground rule: there are children in these pictures. A link that is valid
// forever and that anyone can forward is therefore the wrong default. So every
// link gets an **expiry date** of its own accord, can be **revoked** at any
// time, can be given a **passphrase**, and the page forbids search engines from
// indexing it.
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { one, query } from './db.ts';

/** Without i, l, 0, O, 1 — so a link read out loud does not arrive wrong. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** 12 characters out of 31 = around 59 bits. Not guessable, still readable aloud. */
export function neuerSlug(length = 12): string {
  const bytes = randomBytes(length * 2);
  let s = '';
  for (let i = 0; s.length < length && i < bytes.length; i++) {
    const v = bytes[i];
    // Discard the leftover values, otherwise the earlier characters would come up more often.
    if (v < 256 - (256 % ALPHABET.length)) s += ALPHABET[v % ALPHABET.length];
  }
  return s.length === length ? s : neuerSlug(length);
}

export type ShareKind = 'item' | 'collection';

export interface Share {
  id: string; slug: string; kind: ShareKind;
  title: string | null; note: string | null;
  created_by: string | null;
  expires_at: string | null; revoked_at: string | null;
  allow_download: boolean; password_hash: string | null;
  views: number; downloads: number;
  last_seen_at: string | null; created_at: string;
}

export interface ShareErstellen {
  kind?: ShareKind;
  itemIds: string[];
  title?: string | null;
  note?: string | null;
  /** Days until expiry; 0 or null = unlimited. */
  days?: number | null;
  allowDownload?: boolean;
  password?: string | null;
  userId: string | null;
}

export const MAX_ITEMS = 500;
export const MAX_TITEL = 200;
export const MAX_NOTIZ = 2000;
const MAX_DAYS = 3650;

/**
 * Read the days until expiry properly.
 *
 * `Number('abc')` is `NaN`, and `NaN > 0` is `false` — with the naive spelling
 * every nonsensical input ended up in the "unlimited" branch. Exactly the
 * default this file calls wrong at the top. So: anything that is not a sensible
 * number is rejected instead of being silently interpreted.
 */
export function tageLesen(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  // Accept only a number or a string: `Number([])` is 0 and `Number([7])` is 7 —
  // an array sent along by accident would otherwise silently turn into
  // "unlimited" or into an invented deadline.
  if (typeof v !== 'number' && typeof v !== 'string')
    throw new Error('Validity must be a number of days.');
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Validity must be a number of days.');
  const t = Math.trunc(n);
  if (t < 0 || t > MAX_DAYS) throw new Error(`Validity must be between 0 and ${MAX_DAYS} days.`);
  return t;
}

const short = (v: unknown, max: number): string | null => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Create a link. Without an explicit value the default from the settings
 * applies (30 days) — not "unlimited".
 */
export async function createShare(input: ShareErstellen): Promise<Share> {
  const ids = [...new Set(input.itemIds.filter(Boolean))].slice(0, MAX_ITEMS);
  if (!ids.length) throw new Error('No images selected.');

  const s = await one<{ share_default_days: number }>('SELECT share_default_days FROM settings WHERE id=1');
  const days = tageLesen(input.days, s?.share_default_days ?? 30);
  const expires = days > 0 ? new Date(Date.now() + days * 86400_000) : null;
  const kind: ShareKind = input.kind === 'collection' || ids.length > 1 ? 'collection' : 'item';
  const pw = input.password?.trim() ? await argon2.hash(input.password.trim()) : null;

  const share = await one<Share>(
    `INSERT INTO shares (slug, kind, title, note, created_by, expires_at, allow_download, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [neuerSlug(), kind, short(input.title, MAX_TITEL), short(input.note, MAX_NOTIZ),
     input.userId, expires, input.allowDownload !== false, pw]);

  // Insert in **one** step: before it was up to 500 separate queries, and if one
  // of them failed (because an image had been deleted in the meantime, say), a
  // half-filled link was left behind while the interface reported an error.
  try {
    await query(
      `INSERT INTO share_items (share_id, item_id, position)
       SELECT $1, x.id, x.pos FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, pos)
       ON CONFLICT DO NOTHING`, [share!.id, ids]);
  } catch (e) {
    // No half link: whatever could not come into being completely is removed.
    await query('DELETE FROM shares WHERE id = $1', [share!.id]).catch(() => {});
    throw e;
  }
  return share!;
}

export type ShareStatus = 'ok' | 'not-found' | 'revoked' | 'expired' | 'passphrase';

/**
 * Resolve a link and check whether it is valid right now.
 * Revoked and expired are kept **apart** — the recipient should understand why
 * nothing shows up, instead of suspecting a typo.
 */
export async function resolveShare(slug: string, passphrase?: string | null): Promise<{
  status: ShareStatus; share?: Share;
}> {
  if (!/^[a-z0-9]{6,32}$/.test(String(slug || ''))) return { status: 'not-found' };
  const share = await one<Share>('SELECT * FROM shares WHERE slug=$1', [slug]);
  if (!share) return { status: 'not-found' };
  if (share.revoked_at) return { status: 'revoked', share };
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return { status: 'expired', share };
  if (share.password_hash) {
    if (!passphrase) return { status: 'passphrase', share };
    let ok = false;
    try { ok = await argon2.verify(share.password_hash, passphrase); } catch { ok = false; }
    if (!ok) return { status: 'passphrase', share };
  }
  return { status: 'ok', share };
}

export interface ShareBild {
  id: string; filename: string | null; output_px: string | null; created_at: string;
}

/** The images behind a link, in the stored order. */
export async function shareItems(shareId: string): Promise<ShareBild[]> {
  return query<ShareBild>(
    // No join on `jobs`: per the schema `items.job_id` is nullable, so an INNER
    // JOIN could swallow rows — and nothing from it was needed anyway.
    `SELECT i.id, i.filename, i.output_px, i.created_at
       FROM share_items si
       JOIN items i ON i.id = si.item_id
      WHERE si.share_id = $1 AND i.status = 'done' AND i.result_path IS NOT NULL
      ORDER BY si.position, i.created_at`, [shareId]);
}

/** Does this image belong to this link? Cross-check before every delivery. */
export async function shareHasItem(shareId: string, itemId: string): Promise<boolean> {
  const r = await one<{ item_id: string }>(
    'SELECT item_id FROM share_items WHERE share_id=$1 AND item_id=$2', [shareId, itemId]);
  return !!r;
}

/**
 * Record an access. The IP is stored **hashed only**, salted with the server
 * secret: that makes it possible to count returning visitors, but the address
 * cannot be computed back and nobody is identifiable.
 */
export async function trackShare(
  shareId: string, kind: 'view' | 'download', ip?: string | null, ua?: string | null,
): Promise<void> {
  const salt = process.env.SESSION_SECRET || 'klarbild';
  // The hash takes the link's id into account: that way the same visitor can be
  // recognised **within** one link, but not followed across several links.
  // (Honestly: this is pseudonymisation, not anonymisation — whoever has the
  // server key can work through the IPv4 space. Which is why it is only kept
  // for 90 days.)
  const ipHash = ip
    ? createHash('sha256').update(`${salt}|${shareId}|${ip}`).digest('base64url').slice(0, 22)
    : null;
  const hour = new Date().toISOString().slice(0, 13);   // "2026-09-01T14"
  try {
    // At most one row per visitor and hour — otherwise a single recipient (or an
    // <img> tag on someone else's page) fills up the table.
    const fresh = await query<{ id: string }>(
      `INSERT INTO share_views (share_id, kind, ip_hash, user_agent, hour)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
      [shareId, kind, ipHash, geraet(ua), hour]);

    // The counter counts every call, the visitor number only new ids.
    await query(
      `UPDATE shares SET last_seen_at = now(),
         views     = views     + CASE WHEN $2='view'     THEN 1 ELSE 0 END,
         downloads = downloads + CASE WHEN $2='download' THEN 1 ELSE 0 END,
         visitor  = visitor  + CASE WHEN $3 AND $2='view' THEN 1 ELSE 0 END
       WHERE id = $1`, [shareId, kind, fresh.length > 0]);
  } catch (e: any) {
    // Counting is a side matter — it must never stop the delivery.
    console.error('[share] access not counted:', e?.message || e);
  }
}

/**
 * Keep only the browser and the system from the user agent.
 * The full string is a usable fingerprint; for "what was it opened with"
 * "Safari · iPhone" is plenty.
 */
export function geraet(ua?: string | null): string | null {
  const s = String(ua || '');
  if (!s) return null;
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera'
    : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const system = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad'
    : /Android/.test(s) ? 'Android' : /Macintosh|Mac OS/.test(s) ? 'Mac'
    : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return system ? `${browser} · ${system}` : browser;
}

export interface ShareStat extends Share {
  count: number; visitor: number;
}

/** Overview for the owner (admins see all of them). */
export async function listShares(userId: string | null, isAdmin: boolean): Promise<ShareStat[]> {
  return query<ShareStat>(
    // `count` counts the same conditions as `shareItems` — otherwise the
    // management view names a different number than the page the recipient sees.
    // `visitor` comes from the maintained column instead of an aggregation over
    // share_views: with many accesses this page turned sluggish otherwise.
    `SELECT s.*,
            (SELECT count(*)::int FROM share_items si JOIN items i ON i.id = si.item_id
              WHERE si.share_id = s.id AND i.status='done' AND i.result_path IS NOT NULL) AS count,
            s.visitor
       FROM shares s
      WHERE $2::boolean OR s.created_by = $1
      ORDER BY s.created_at DESC LIMIT 200`, [userId, isAdmin]);
}

/** Revoke — the link stays in place, but delivers nothing any more. */
export async function revokeShare(id: string, userId: string | null, isAdmin: boolean): Promise<boolean> {
  const r = await query<{ id: string }>(
    `UPDATE shares SET revoked_at = now()
      WHERE id = $1 AND ($3::boolean OR created_by = $2) AND revoked_at IS NULL RETURNING id`,
    [id, userId, isAdmin]);
  return r.length > 0;
}

/** Release it again — handy when you clicked the wrong thing. */
export async function unrevokeShare(id: string, userId: string | null, isAdmin: boolean): Promise<boolean> {
  const r = await query<{ id: string }>(
    `UPDATE shares SET revoked_at = NULL
      WHERE id = $1 AND ($3::boolean OR created_by = $2) RETURNING id`, [id, userId, isAdmin]);
  return r.length > 0;
}

export interface ShareAendern {
  title?: string | null; note?: string | null;
  days?: number | null; allowDownload?: boolean;
  /** Empty text removes the passphrase. */
  password?: string | null;
}

export async function updateShare(
  id: string, userId: string | null, isAdmin: boolean, a: ShareAendern,
): Promise<boolean> {
  const own = await one<{ id: string }>(
    'SELECT id FROM shares WHERE id=$1 AND ($3::boolean OR created_by=$2)', [id, userId, isAdmin]);
  if (!own) return false;

  const sets: string[] = []; const args: any[] = [id];
  const set = (col: string, val: any) => { args.push(val); sets.push(`${col}=$${args.length}`); };
  if (a.title !== undefined) set('title', short(a.title, MAX_TITEL));
  if (a.note !== undefined) set('note', short(a.note, MAX_NOTIZ));
  if (a.allowDownload !== undefined) set('allow_download', !!a.allowDownload);
  if (a.days !== undefined) {
    const t = tageLesen(a.days, 0);
    set('expires_at', t > 0 ? new Date(Date.now() + t * 86400_000) : null);
  }
  if (a.password !== undefined) {
    set('password_hash', a.password?.trim() ? await argon2.hash(a.password.trim()) : null);
  }
  if (!sets.length) return true;
  await query(`UPDATE shares SET ${sets.join(',')} WHERE id=$1`, args);
  return true;
}

export async function deleteShare(id: string, userId: string | null, isAdmin: boolean): Promise<boolean> {
  const r = await query<{ id: string }>(
    'DELETE FROM shares WHERE id=$1 AND ($3::boolean OR created_by=$2) RETURNING id', [id, userId, isAdmin]);
  return r.length > 0;
}

/** Constant-time comparison — its duration does not give away how close you were. */
export function gleich(a: string, b: string): boolean {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/* ---------------- Names inside the collected package ---------------- */

/**
 * Unique file names within one ZIP.
 *
 * Two identical names in the same archive are not an error while packing — they
 * only show up when **unpacking**, where the second overwrites the first or the
 * unpacker asks back. Both annoying, both avoidable.
 *
 * `taken` is written on as it goes; the function is therefore deliberately not
 * pure but works on the state of the running archive.
 */
export function archiveName(
  raw: string | null | undefined, taken: Map<string, number>, defaultExt = 'jpg',
): string {
  let name = String(raw || '').replace(/[/\\]/g, '_').replace(/[\u0000-\u001f]/g, '').trim()
    || `image.${defaultExt}`;
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += `.${defaultExt}`;
  const n = taken.get(name);
  if (n == null) { taken.set(name, 0); return name; }
  taken.set(name, n + 1);
  return name.replace(/(\.[^.]+)$/, `_${n + 1}$1`);
}

/** File name for the collected package: date and title, reduced to file-system characters. */
export function packageName(title: string | null | undefined, on = new Date()): string {
  const slug = String(title || '').toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c] || c))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'klarbild';
  return `${on.toISOString().slice(0, 10)}_${slug}.zip`;
}

/* ---------------- Proof of a checked passphrase ----------------
 * `argon2.verify` costs around 130 ms and 64 MiB — and used to run on **every**
 * request, so on every single image of a folder too. A page with 40 images
 * would have driven the process into the memory limit, and a few dozen requests
 * with the wrong word would have brought the whole application to a halt.
 *
 * So: check once, then carry along a short-lived, signed proof that is valid
 * **for this one link only**.                                              */

const PROOF_LIFETIME = 6 * 60 * 60;   // 6 hours

export const proofName = (slug: string) => `kb_s_${slug}`;

export function proofBuild(shareId: string): string {
  const until = Math.floor(Date.now() / 1000) + PROOF_LIFETIME;
  const sig = createHmac('sha256', process.env.SESSION_SECRET || 'klarbild')
    .update(`${shareId}.${until}`).digest('base64url');
  return `${until}.${sig}`;
}

export function proofValid(shareId: string, value?: string | null): boolean {
  if (!value) return false;
  const [untilRaw, sig] = String(value).split('.');
  const until = Number(untilRaw);
  if (!Number.isFinite(until) || until < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', process.env.SESSION_SECRET || 'klarbild')
    .update(`${shareId}.${until}`).digest('base64url');
  return !!sig && gleich(sig, expected);
}

/** Pull the proof out of the cookie header. */
export function proofFromCookie(cookieHeader: string | null | undefined, slug: string): string | null {
  const name = proofName(slug);
  return cookieHeader?.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}
