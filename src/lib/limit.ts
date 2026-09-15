// Rate limiting, and the question of whose sender address you believe.
//
// Deliberately without a dependency and in memory: Klarbild runs as **one** Node
// process. If a second one were ever added, this belongs in the database or in
// Redis — and then this file is the one place you swap out.

/**
 * The caller's actual address.
 *
 * Important and easy to overlook: Astro's `clientAddress` takes the **first**
 * value out of `X-Forwarded-For`. That value is sent by the attacker themselves
 * — a reverse proxy appends the real address at the end. Any limit that builds
 * on `clientAddress` can be circumvented by varying the header from request to
 * request.
 *
 * That is why it counts from the right: with `TRUSTED_PROXIES=1` (the default,
 * one proxy in front such as Traefik) the last entry is the one the proxy set
 * itself — nobody from outside can forge that. Without a proxy
 * (`TRUSTED_PROXIES=0`) the header is not considered at all.
 */
export function realIp(request: Request, fallback?: string | null): string {
  const trusted = Number(process.env.TRUSTED_PROXIES ?? '1');
  if (!Number.isFinite(trusted) || trusted <= 0) return fallback || 'unknown';
  const chain = (request.headers.get('x-forwarded-for') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!chain.length) return fallback || 'unknown';
  // From the right, as many hops back as there are trustworthy proxies.
  const i = Math.max(0, chain.length - trusted);
  return chain[i] || fallback || 'unknown';
}

interface Entry { n: number; until: number }
const buckets = new Map<string, Entry>();
let lastCleanup = 0;

/** Remove expired entries — selectively, not everything at once. */
function cleanUp(now: number): void {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [k, e] of buckets) if (e.until < now) buckets.delete(k);
  // Emergency brake in case too much piles up anyway: the oldest ones first.
  if (buckets.size > 50_000) {
    const byAge = [...buckets.entries()].sort((a, b) => a[1].until - b[1].until);
    for (const [k] of byAge.slice(0, buckets.size - 25_000)) buckets.delete(k);
  }
}

/**
 * Count one attempt. Returns `true` when the limit has been exceeded.
 *
 * Unlike before, the whole table is **not** cleared when it grows large — that
 * would have let an attacker reset everybody else's counters along with theirs.
 */
export function tooOften(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  cleanUp(now);
  const e = buckets.get(key);
  if (!e || e.until < now) { buckets.set(key, { n: 1, until: now + windowMs }); return false; }
  e.n++;
  return e.n > max;
}

/** Reset the counter — after a successful operation. */
export const resetPassword = (key: string): void => { buckets.delete(key); };

/** How many attempts are still free in the running window. */
export function attemptsLeft(key: string, max: number): number {
  const e = buckets.get(key);
  if (!e || e.until < Date.now()) return max;
  return Math.max(0, max - e.n);
}
