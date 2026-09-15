import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../astro.config.mjs';

/**
 * Astro's config schema ignores keys it does not know — silently, with no
 * warning. That is how the Content-Security-Policy went missing once: Astro 7
 * moved `csp` from `experimental` to `security`, a top-level `csp` key kept
 * type-checking and building, and the deployed site served no policy at all.
 * Nothing in the build output said so. This test does.
 */
test('The CSP lives where Astro 7 reads it', () => {
  const security = (config as any).security;
  assert.ok(security, 'astro.config.mjs has no `security` block');
  assert.ok(security.csp, 'the CSP must sit at `security.csp` — a top-level `csp` is ignored');
  assert.ok(Array.isArray(security.csp.directives), '`security.csp.directives` must be a list');

  // The directives the middleware does not add itself.
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
    assert.ok(security.csp.directives.includes(d), `missing directive: ${d}`);
  }
});

test('No stray top-level `csp` or `experimental.csp` key', () => {
  assert.equal((config as any).csp, undefined, 'a top-level `csp` key is ignored by Astro 7');
  assert.equal((config as any).experimental?.csp, undefined, '`experimental.csp` is gone in Astro 7');
});
