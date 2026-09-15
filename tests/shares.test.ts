import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neuerSlug, tageLesen, geraet, gleich, proofBuild, proofValid, proofFromCookie, proofName,
  MAX_TITEL, MAX_NOTIZ } from '../src/lib/shares.ts';

process.env.SESSION_SECRET ||= 'test-secret-for-the-tests';

test('Slugs are long enough, easy to read out and hard to confuse', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const s = neuerSlug();
    assert.equal(s.length, 12, `wrong length: ${s}`);
    // No i, l, 0, O, 1 — otherwise they get misheard over the phone.
    assert.match(s, /^[abcdefghjkmnpqrstuvwxyz23456789]+$/, `forbidden character: ${s}`);
    assert.ok(!seen.has(s), `slug repeated after ${i} draws: ${s}`);
    seen.add(s);
  }
});

test('The characters are evenly distributed — otherwise the search space shrinks', () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 4000; i++) for (const c of neuerSlug()) counts.set(c, (counts.get(c) || 0) + 1);
  const values = [...counts.values()];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  for (const [c, n] of counts) {
    assert.ok(Math.abs(n - mean) / mean < 0.25, `${c} comes up ${n}× instead of ~${Math.round(mean)}×`);
  }
});

test('Nonsensical expiry values are rejected, not read as "unlimited"', () => {
  // Exactly the bug the review found: Number('abc') is NaN, NaN > 0 is false —
  // and the link then held good forever.
  for (const bad of ['abc', -5, 1e9, Infinity, NaN, {}, [], 'tomorrow']) {
    assert.throws(() => tageLesen(bad, 30), /Validity/, `slipped through: ${JSON.stringify(bad)}`);
  }
});

test('Sensible expiry values come through, the default applies when one is left out', () => {
  assert.equal(tageLesen(7, 30), 7);
  assert.equal(tageLesen('30', 30), 30);
  assert.equal(tageLesen(0, 30), 0);            // 0 = deliberately unlimited
  assert.equal(tageLesen(3650, 30), 3650);
  assert.equal(tageLesen(undefined, 30), 30);
  assert.equal(tageLesen(null, 30), 30);
  assert.equal(tageLesen('', 30), 30);
  assert.equal(tageLesen(7.9, 30), 7);          // truncated, not rounded
});

test('Only the browser and the system are left over from the user agent', () => {
  const cases = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'Safari · iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', 'Chrome · Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0', 'Firefox · Mac'],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36', 'Chrome · Android'],
  ] as const;
  for (const [ua, expected] of cases) assert.equal(geraet(ua), expected, ua.slice(0, 40));
  assert.equal(geraet(''), null);
  assert.equal(geraet(null), null);
  // The fingerprint must not give away more than the browser and the system.
  for (const [ua] of cases) assert.ok((geraet(ua) || '').length < 25, 'kept too much detail');
});

test('The proof for the passphrase is only valid for its own link', () => {
  const a = 'aaaaaaaa-0000-0000-0000-000000000001';
  const b = 'bbbbbbbb-0000-0000-0000-000000000002';
  const n = proofBuild(a);
  assert.ok(proofValid(a, n), 'its own link was rejected');
  assert.ok(!proofValid(b, n), 'the proof is valid for somebody else\'s link');
  assert.ok(!proofValid(a, 'nonsense'), 'nonsense accepted');
  assert.ok(!proofValid(a, ''), 'empty value accepted');
  assert.ok(!proofValid(a, null), 'null accepted');
});

test('An expired or forged proof is rejected', () => {
  const id = 'aaaaaaaa-0000-0000-0000-000000000001';
  const [, sig] = proofBuild(id).split('.');
  const past = Math.floor(Date.now() / 1000) - 10;
  assert.ok(!proofValid(id, `${past}.${sig}`), 'an expired proof came through');
  // Push the expiry forward without knowing the signature → has to fail.
  const future = Math.floor(Date.now() / 1000) + 999999;
  assert.ok(!proofValid(id, `${future}.${sig}`), 'a tampered lifetime came through');
});

test('The proof is read out of the right cookie', () => {
  const header = `other=x; ${proofName('abc123def456')}=value.sig; more=y`;
  assert.equal(proofFromCookie(header, 'abc123def456'), 'value.sig');
  assert.equal(proofFromCookie(header, 'anotherone12'), null);
  assert.equal(proofFromCookie(null, 'abc123def456'), null);
});

test('gleich() compares in constant time and does not trip over lengths', () => {
  assert.ok(gleich('abc', 'abc'));
  assert.ok(!gleich('abc', 'abd'));
  assert.ok(!gleich('abc', 'abcd'));
  assert.ok(!gleich('', 'x'));
  assert.ok(gleich('', ''));
});

test('The length limits are in place', () => {
  assert.ok(MAX_TITEL > 0 && MAX_TITEL <= 500);
  assert.ok(MAX_NOTIZ > MAX_TITEL);
});
