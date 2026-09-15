import argon2 from 'argon2';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { one, query } from './db';

export interface SessionUser { uid: string; role: 'user' | 'admin'; name: string; username?: string; }
/** What is actually in the cookie — including the fields that make it revocable. */
interface SessionPayload extends SessionUser { iat: number; ep: number }

const COOKIE = 'kb_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false);

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is missing');
  return s;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function makeSessionCookie(u: SessionUser, epoch = 0): string {
  const payload = Buffer.from(JSON.stringify({ ...u, iat: Math.floor(Date.now() / 1000), ep: epoch }))
    .toString('base64url');
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

export const clearSessionCookie = () =>
  `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/**
 * Check the cookie — signature **and** age.
 *
 * The age check is not cosmetics: `Max-Age` is a request to the browser, not a
 * rule for the server. Without it a cookie that has leaked once stays valid
 * without limit, years later and via curl as well.
 *
 * Whether the cookie is still valid **in substance** (password changed, role
 * withdrawn, account deleted) cannot be decided here — that needs the database.
 * `verifySession` in the middleware takes care of it.
 */
export function readSession(cookieHeader?: string | null): (SessionUser & { ep: number }) | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    if (!obj.uid || typeof obj.iat !== 'number') return null;
    if (Math.floor(Date.now() / 1000) - obj.iat > MAX_AGE) return null;   // expired as far as the server is concerned
    return { uid: obj.uid, role: obj.role, name: obj.name, ep: Number(obj.ep) || 0 };
  } catch {
    return null;
  }
}

/**
 * Cross-check in the database: does the account still exist, is the session
 * epoch still valid, and which role does it have **now**?
 *
 * The role deliberately comes from the database and not from the cookie —
 * otherwise a downgraded admin would keep their rights until the cookie expires.
 * It is a point lookup over the primary key, which `tokenUser` does anyway.
 */
export async function verifySession(s: (SessionUser & { ep: number }) | null): Promise<SessionUser | null> {
  if (!s?.uid) return null;
  const u = await one<{ role: 'user' | 'admin'; display_name: string | null; username: string; session_epoch: number }>(
    'SELECT role, display_name, username, session_epoch FROM users WHERE id = $1', [s.uid]);
  if (!u) return null;                                  // account deleted
  if ((u.session_epoch ?? 0) !== s.ep) return null;     // password changed or role changed
  return { uid: s.uid, role: u.role, name: u.display_name || u.username };
}

/** Invalidate all sessions of an account — after a password change or a role change. */
export async function bumpSessionEpoch(userId: string): Promise<void> {
  await query('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = $1', [userId]);
}

export async function login(
  username: string, password: string,
): Promise<{ user: SessionUser; epoch: number } | null> {
  const u = await one<{ id: string; password_hash: string; role: 'user' | 'admin'; display_name: string; username: string; session_epoch: number }>(
    'SELECT id, password_hash, role, display_name, username, session_epoch FROM users WHERE username=$1', [username]);
  if (!u) return null;
  if (!(await verifyPassword(u.password_hash, password))) return null;
  return {
    user: { uid: u.id, role: u.role, name: u.display_name || u.username },
    epoch: u.session_epoch ?? 0,
  };
}

// --- simple in-memory rate limiter: max 5 failed attempts / 15 min per IP ---
const attempts = new Map<string, { count: number; until: number }>();
export function rateLimited(ip: string): boolean {
  const e = attempts.get(ip);
  return !!e && e.count >= 5 && Date.now() < e.until;
}
export function noteFailure(ip: string): void {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || now >= e.until) attempts.set(ip, { count: 1, until: now + 15 * 60_000 });
  else e.count++;
}
export function clearFailures(ip: string): void { attempts.delete(ip); }
