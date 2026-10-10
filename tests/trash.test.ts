import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectKeysOf, daysLeft } from '../src/lib/trash.ts';
import { canRead, canWrite } from '../src/lib/itemaccess.ts';

test('Every stored file of an image is found, each once', () => {
  assert.deepEqual(
    objectKeysOf({ source_path: 'sources/a.png', result_path: 'results/a.png', thumb_path: 'thumbs/a.webp',
      source_paths: ['sources/a.png', 'sources/b.png'] }),
    ['sources/a.png', 'results/a.png', 'thumbs/a.webp', 'sources/b.png']);
  assert.deepEqual(objectKeysOf({ source_path: null, result_path: '', thumb_path: undefined, source_paths: null }), []);
});

test('Days left in the trash count down and never go negative', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(daysLeft('2026-10-10T12:00:00Z', 30, now), 30);
  assert.equal(daysLeft('2026-10-09T12:00:00Z', 30, now), 29);
  assert.equal(daysLeft('2026-10-09T11:00:00Z', 30, now), 29);   // 28.96 days -> rounded up
  assert.equal(daysLeft('2026-09-10T12:00:00Z', 30, now), 0);    // exactly due
  assert.equal(daysLeft('2026-01-01T00:00:00Z', 30, now), 0);    // long overdue
  assert.equal(daysLeft('2026-10-10T12:00:00Z', 0, now), 0);     // trash switched off
});

test('Reading: own, admin, or a shared library — never another person\'s private session', () => {
  const me = { uid: 'u1', role: 'user' }, admin = { uid: 'a', role: 'admin' };
  const mine = { created_by: 'u1', private: false }, theirs = { created_by: 'u2', private: false };
  const theirsPrivate = { created_by: 'u2', private: true };
  assert.equal(canRead(me, mine, false), true);
  assert.equal(canRead(me, theirs, false), false);
  assert.equal(canRead(me, theirs, true), true);
  assert.equal(canRead(me, theirsPrivate, true), false);
  assert.equal(canRead(admin, theirsPrivate, false), true);
});

test('Writing: own or admin only — a shared library is for looking, not for deleting', () => {
  const me = { uid: 'u1', role: 'user' };
  assert.equal(canWrite(me, { created_by: 'u1' }), true);
  assert.equal(canWrite(me, { created_by: 'u2' }), false);
  assert.equal(canWrite({ uid: null, role: 'user' }, { created_by: null }), false);
  assert.equal(canWrite({ uid: 'x', role: 'admin' }, { created_by: 'u2' }), true);
});
