import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveName, packageName } from '../src/lib/shares.ts';

/**
 * Names inside the collected package. Two identical names in one ZIP are not an
 * error while packing — they only show up when **unpacking**, where the second
 * one overwrites the first. That is why there is a test for it.
 */

test('Identical file names are numbered through', () => {
  const seen = new Map<string, number>();
  assert.equal(archiveName('bild.png', seen), 'bild.png');
  assert.equal(archiveName('bild.png', seen), 'bild_1.png');
  assert.equal(archiveName('bild.png', seen), 'bild_2.png');
  assert.equal(archiveName('anderes.png', seen), 'anderes.png');
});

test('Names cannot break out of the archive', () => {
  const seen = new Map<string, number>();
  for (const evil of ['../../etc/passwd', 'a/b/c.png', 'a\\b.png', '/absolute.png']) {
    const n = archiveName(evil, seen);
    assert.ok(!n.includes('/') && !n.includes('\\'), `separator survived: ${n}`);
  }
});

test('Control characters are thrown out', () => {
  const seen = new Map<string, number>();
  assert.equal(archiveName('ab\u0007c.png', seen), 'abc.png');
  assert.equal(archiveName('line\nbreak.png', seen), 'linebreak.png');
});

test('Missing names and names without an extension get something usable', () => {
  const seen = new Map<string, number>();
  assert.equal(archiveName(null, seen), 'image.jpg');
  assert.equal(archiveName('', seen), 'image_1.jpg');
  assert.equal(archiveName('   ', seen), 'image_2.jpg');
  assert.equal(archiveName('no-extension', seen), 'no-extension.jpg');
  assert.equal(archiveName('with.png', seen), 'with.png');
  assert.equal(archiveName('with.PNG', seen), 'with.PNG');
});

test('Real Klarbild names stay unchanged', () => {
  const seen = new Map<string, number>();
  const n = '2026-08-20_143207_portrait-badge_the-frame_a3f9.jpg';
  assert.equal(archiveName(n, seen), n);
});

test('The package is named after the date and the title', () => {
  const on = new Date('2026-09-01T10:00:00Z');
  assert.equal(packageName('Daycare August 2026', on), '2026-09-01_daycare-august-2026.zip');
  assert.equal(packageName('Müller & Söhne', on), '2026-09-01_mueller-soehne.zip');
  assert.equal(packageName(null, on), '2026-09-01_klarbild.zip');
  assert.equal(packageName('', on), '2026-09-01_klarbild.zip');
  assert.equal(packageName('!!!', on), '2026-09-01_klarbild.zip');
});

test('The package name gets along with every file system', () => {
  const on = new Date('2026-09-01T10:00:00Z');
  for (const title of ['Grüße aus Köln / part 2', 'a\\b:c*d?e"f<g>h|i', '../../..', 'x'.repeat(200)]) {
    const n = packageName(title, on);
    assert.ok(!/[^a-z0-9_.-]/.test(n), `unexpected character in ${n}`);
    assert.ok(n.length < 60, `too long: ${n.length}`);
    assert.ok(n.endsWith('.zip'));
  }
});
