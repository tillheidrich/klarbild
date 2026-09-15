import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultFilename, timeStamp, shortTag, slugify, KLARBILD_NAME, splitOldName, newNameFor } from '../src/lib/naming.ts';

const AT = new Date('2026-08-20T12:32:07Z');          // = 14:32:07 in Berlin (summer time)
const ID1 = 'a3f9c1de-1111-2222-3333-444455556666';
const ID2 = '77b21e00-1111-2222-3333-444455556666';

test('The reported bug: two badges on the same day no longer overwrite each other', () => {
  // Same motif, same size, same second — this used to produce the same name twice.
  const a = buildResultFilename('Portrait Badge.png', 'the-frame', 'jpg', { at: AT, id: ID1 });
  const b = buildResultFilename('Portrait Badge.png', 'the-frame', 'jpg', { at: AT, id: ID2 });
  assert.notEqual(a, b, 'two images must never carry the same name');
  assert.equal(a, '2026-08-20_143207_portrait-badge_the-frame_a3f9.jpg');
  assert.equal(b, '2026-08-20_143207_portrait-badge_the-frame_77b2.jpg');
});

test('Names sort lexicographically = chronologically', () => {
  const times = [
    new Date('2026-08-19T23:59:59Z'),
    new Date('2026-08-20T00:00:01Z'),
    new Date('2026-08-20T12:32:07Z'),
    new Date('2026-12-24T08:00:00Z'),   // winter time — a different offset from UTC
    new Date('2027-01-01T00:00:00Z'),
  ];
  const names = times.map((at, i) => buildResultFilename('photo', '30x40', 'jpg', { at, id: `${i}${i}${i}${i}0000-0000-0000-0000-000000000000` }));
  const sorted = [...names].sort();
  assert.deepEqual(sorted, names, `sort order differs:\n${sorted.join('\n')}`);
});

test('The timestamp is in local time, not in UTC', () => {
  // 00:30 Berlin summer time is 22:30 UTC on the previous day — the name has to
  // show the day on which the image was made.
  assert.equal(timeStamp(new Date('2026-08-19T22:30:00Z')), '2026-08-20_003000');
  assert.equal(timeStamp(new Date('2026-12-24T07:05:09Z')), '2026-12-24_080509');   // winter time: +1
});

test('Midnight is written as 00, not as 24', () => {
  assert.match(timeStamp(new Date('2026-08-19T22:00:00Z')), /^2026-08-20_00000/);
});

test('The short id is stable — a second run gives the same name', () => {
  assert.equal(shortTag(ID1), shortTag(ID1));
  assert.equal(shortTag(ID1), 'a3f9');
  const it = { id: ID1, filename: '2026-07-23_portrait_the-frame.png', created_at: AT };
  assert.equal(newNameFor(it), newNameFor(it));
});

test('Processing an image again does not stack up stamps', () => {
  const once = buildResultFilename('Portrait Badge.png', 'the-frame', 'jpg', { at: AT, id: ID1 });
  const twice = buildResultFilename(once, '30x40', 'jpg', { at: AT, id: ID2 });
  assert.equal(twice, '2026-08-20_143207_portrait-badge_30x40_77b2.jpg');
  const thrice = buildResultFilename(twice, 'a4', 'jpg', { at: AT, id: ID1 });
  assert.equal(thrice, '2026-08-20_143207_portrait-badge_a4_a3f9.jpg');
});

test('Our own pattern recognises our own names and only those', () => {
  assert.ok(KLARBILD_NAME.test('2026-08-20_143207_portrait-badge_the-frame_a3f9'));
  assert.ok(KLARBILD_NAME.test('2026-08-20_143207_portrait_30x40_a3f9-2'));
  assert.ok(!KLARBILD_NAME.test('2026-07-23_portrait_the-frame'));      // the old scheme
  assert.ok(!KLARBILD_NAME.test('holiday-2026_beach'));                 // somebody else's name
});

test('Old names are split up correctly', () => {
  assert.deepEqual(splitOldName('2026-07-23_portrait_the-frame.png'), { motif: 'portrait', format: 'the-frame', ext: 'png' });
  assert.deepEqual(splitOldName('2026-07-23_klarbild_30x40.jpg'), { motif: 'klarbild', format: '30x40', ext: 'jpg' });
  // A foreign file without our scheme: all of it becomes the motif, format "original".
  assert.deepEqual(splitOldName('Holiday Crete.JPEG'), { motif: 'holiday-crete', format: 'original', ext: 'jpeg' });
  // Already in the new scheme: motif and format stay, so that renaming is idempotent.
  assert.deepEqual(splitOldName('2026-08-20_143207_portrait-badge_the-frame_a3f9.jpg'),
    { motif: 'portrait-badge', format: 'the-frame', ext: 'jpg' });
});

test('Renaming is idempotent — a second run changes nothing', () => {
  const old = { id: ID1, filename: '2026-07-23_portrait_the-frame.png', created_at: new Date('2026-07-23T09:15:42Z') };
  const fresh = newNameFor(old);
  assert.equal(fresh, '2026-07-23_111542_portrait_the-frame_a3f9.png');
  assert.equal(newNameFor({ ...old, filename: fresh }), fresh, 'the second run has to give the same name');
});

test('Renaming takes the creation date, not the date out of the old name', () => {
  // If a name ever carried a wrong date, created_at from the database wins.
  const it = { id: ID2, filename: '2020-01-01_portrait_a4.png', created_at: new Date('2026-03-05T06:00:00Z') };
  assert.match(newNameFor(it), /^2026-03-05_070000_portrait_a4_77b2\.png$/);
});

test('A counter is appended when a name is really taken', () => {
  const a = buildResultFilename('portrait', 'a4', 'png', { at: AT, id: ID1 });
  const b = buildResultFilename('portrait', 'a4', 'png', { at: AT, id: ID1, seq: 2 });
  assert.equal(b, a.replace('.png', '-2.png'));
  assert.ok(KLARBILD_NAME.test(b.replace('.png', '')));
});

test('Motifs stay readable and usable on a file system', () => {
  const n = buildResultFilename('Größe & Maß – Übersicht!.png', '13x18', 'jpg', { at: AT, id: ID1 });
  assert.equal(n, '2026-08-20_143207_groesse-mass-uebersicht_13x18_a3f9.jpg');
  assert.ok(!/[^a-z0-9._-]/.test(n), `unexpected character in ${n}`);
});

test('Generic names become "klarbild" instead of inheriting nonsense', () => {
  for (const n of ['IMG.png', 'foto.jpg', 'telegram.jpg', null]) {
    const out = buildResultFilename(n as any, 'a4', 'png', { at: AT, id: ID1 });
    assert.match(out, /_klarbild_a4_a3f9\.png$/, `${n} → ${out}`);
  }
});

test('slugify stays usable unchanged', () => {
  assert.equal(slugify('Grüße aus Köln'), 'gruesse-aus-koeln');
});

// --- Collision loop (belt and braces) ----------------------------------------
// The loop is tested with an injected "is taken" check, so that no database has
// to be running for it.
import { uniqueFilename } from '../src/lib/renames.ts';

test('If the wanted name is taken after all, a counter is appended', async () => {
  const taken = new Set(['2026-08-20_143207_portrait_a4_a3f9.png']);
  const n = await uniqueFilename(ID1, 'portrait', 'a4', 'png', AT, async (x) => taken.has(x));
  assert.equal(n, '2026-08-20_143207_portrait_a4_a3f9-2.png');
});

test('A free name is handed out unchanged', async () => {
  const n = await uniqueFilename(ID1, 'portrait', 'a4', 'png', AT, async () => false);
  assert.equal(n, '2026-08-20_143207_portrait_a4_a3f9.png');
});

test('Even with permanently taken names the loop returns something', async () => {
  const n = await uniqueFilename(ID1, 'portrait', 'a4', 'png', AT, async () => true);
  assert.ok(n.endsWith('.png') && n.length > 10, `unusable fallback: ${n}`);
});

// --- Path escape on delivery -------------------------------------------------
// `posixpath.join('/customers/acme','../../../etc/cron.d')` gives `/etc/cron.d`,
// and the upload creates that directory beforehand. That is why the check runs
// immediately before writing — here is the check itself.
import { safeSegment } from '../src/lib/remotetarget.ts';

test('Folder and file names cannot leave the base folder', () => {
  const evil = ['..', '../..', '../../../etc/cron.d', 'a/b', 'a\\b', '.', '...',
                'Gallery A/../..', 'y\ny', 'z\u0000z'];
  for (const b of evil) {
    assert.throws(() => safeSegment(b, 'folder'), /Invalid/, `slipped through: ${JSON.stringify(b)}`);
  }
});

test('Real customer folders stay allowed — the check is not there to annoy', () => {
  const good = ['Gallery A', 'TheFrame-Backgrounds', 'Müller & Söhne (2026)',
                "Wedding O'Brien", 'Daycare 2026_Group 3', 'a.b.c',
                '2026-08-20_143207_portrait-badge_the-frame_a3f9.jpg'];
  for (const g of good) assert.equal(safeSegment(g, 'folder'), g, `wrongly rejected: ${g}`);
});

test('An empty name is allowed and means "no subfolder"', () => {
  assert.equal(safeSegment('', 'folder'), '');
  assert.equal(safeSegment('   ', 'folder'), '');
});
