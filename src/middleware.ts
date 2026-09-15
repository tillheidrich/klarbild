import { defineMiddleware } from 'astro:middleware';
import { ensureInit } from './lib/init';
import { readSession, verifySession } from './lib/auth';
import { one } from './lib/db';
import { LOCALE_COOKIE, resolveLocale, isLocale } from './lib/i18n';

const PUBLIC_PATHS = [
  /^\/login/, /^\/tour/, /^\/api\/auth\/login/, /^\/api\/health/,
  /^\/api\/telegram\/webhook/, /^\/llms\.txt/,
  // Forgot password — must be reachable without being signed in, otherwise it's pointless.
  /^\/password/, /^\/api\/auth\/reset/,
  // Share links: whoever has the link sees the images — that's what they're for.
  // The check lives in the link itself (expiry, revocation, passphrase).
  /^\/s\//, /^\/api\/s\//,
];

/** API token (Authorization: Bearer …) → a synthetic admin user for /api/*. */
async function tokenUser(header: string | null): Promise<any | null> {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m) return null;
  const s = await one<{ api_token: string | null }>('SELECT api_token FROM settings WHERE id=1');
  if (!s?.api_token || s.api_token !== m[1].trim()) return null;
  const admin = await one<{ id: string }>(`SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`);
  return { uid: admin?.id || null, role: 'admin', name: 'API', username: 'api' };
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  // Health/webhook may run even if init is still stuck — otherwise nothing works.
  try { await ensureInit(); } catch (e) { if (ctx.url.pathname !== '/api/health') throw e; }

  // `readSession` checks the signature and age; whether the account still exists,
  // the role still matches and the session state is still valid is only decided
  // by the database — otherwise a cookie would survive every password change.
  let user = await verifySession(readSession(ctx.request.headers.get('cookie')));
  // Programmatic access via API token (only for /api/*, except the admin area).
  if (!user && ctx.url.pathname.startsWith('/api/') && !ctx.url.pathname.startsWith('/api/admin')) {
    user = await tokenUser(ctx.request.headers.get('authorization'));
  }
  ctx.locals.user = user;

  // Language for this request (see lib/i18n.ts for the order of precedence).
  const wish = ctx.url.searchParams.get('lang');
  const cookieLang = ctx.cookies.get(LOCALE_COOKIE)?.value ?? null;
  const locale = resolveLocale({ query: wish, cookie: cookieLang, env: process.env.KLARBILD_LOCALE ?? null });
  ctx.locals.locale = locale;
  if (isLocale(wish) && wish !== cookieLang) {
    ctx.cookies.set(LOCALE_COOKIE, wish, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 60 * 60 * 24 * 365 });
  }

  const path = ctx.url.pathname;
  const isPublic = PUBLIC_PATHS.some((r) => r.test(path));
  if (!isPublic && !user) {
    if (path.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
    return ctx.redirect('/login');
  }
  if (path.startsWith('/api/admin') || path.startsWith('/admin')) {
    if (user?.role !== 'admin') {
      if (path.startsWith('/api/')) return new Response('Forbidden', { status: 403 });
      return ctx.redirect('/');
    }
  }
  return withSecurityHeaders(await next());
});

/**
 * Security headers. Astro itself builds the Content-Security-Policy at build time
 * (`experimental.csp` in `astro.config.mjs`) and attaches real **hashes** for every
 * inline script of ours — so no `'unsafe-inline'` for scripts, which is the
 * important part against injected code.
 *
 * `style-src` is deliberately set back to `'unsafe-inline'` here: React sets
 * styles as an attribute on the element (`style={{…}}`), and attributes cannot be
 * hashed. Measured: with a pure hash policy the browser blocks them, and the
 * preview in the print module loses its layout. What remains exposed — CSS-based
 * exfiltration — is a much narrower class of attack than script injection, and
 * that one stays closed.
 */
function withSecurityHeaders(res: Response): Response {
  const csp = res.headers.get('content-security-policy');
  if (csp) {
    res.headers.set('content-security-policy',
      csp.replace(/style-src[^;]*/i, "style-src 'self' 'unsafe-inline'"));
  }
  // No MIME sniffing: result files are served with a detected type, the
  // browser should not guess on its own and run something as a script.
  res.headers.set('x-content-type-options', 'nosniff');
  // Don't send the path along when navigating to another site (folder names!).
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  // Older browsers without CSP frame-ancestors.
  res.headers.set('x-frame-options', 'DENY');
  // None of these interfaces are needed.
  res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  return res;
}
