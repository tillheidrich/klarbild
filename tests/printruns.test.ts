import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../src/lib/printruns.ts';

/**
 * The short summary stands in the history list. It arrives cell by cell — two
 * cells with the same size must not show up there twice.
 */

test('A single size stays as it is', () => {
  assert.equal(summarise(['13 × 18 cm']), '13 × 18 cm');
});

test('Identical sizes are pulled together', () => {
  assert.equal(summarise(['10 × 15 cm', '10 × 15 cm']), '10 × 15 cm ×2');
});

test('Existing piece counts are added up, not appended', () => {
  assert.equal(summarise(['35 × 45 mm ×8', '35 × 45 mm ×4']), '35 × 45 mm ×12');
  assert.equal(summarise(['10 × 15 cm ×3', '10 × 15 cm']), '10 × 15 cm ×4');
});

test('Different sizes stay side by side, in the order they came in', () => {
  assert.equal(summarise(['13 × 18 cm', '35 × 45 mm ×8']), '13 × 18 cm, 35 × 45 mm ×8');
});

test('Additions such as (poster) keep the groups apart', () => {
  assert.equal(summarise(['30 × 40 cm ×2 (poster)', '30 × 40 cm ×1 (poster)']),
    '30 × 40 cm ×3 (poster)');
  assert.equal(summarise(['30 × 40 cm (poster)', '30 × 40 cm (oversize)']),
    '30 × 40 cm (poster), 30 × 40 cm (oversize)');
});

test('An empty list gives something readable', () => {
  assert.equal(summarise([]), 'Print sheet');
});

test('Very long enumerations are shortened', () => {
  const many = Array.from({ length: 40 }, (_, i) => `${i + 10} × ${i + 15} cm`);
  const s = summarise(many);
  assert.ok(s.length <= 118, `too long: ${s.length}`);
  assert.ok(s.endsWith('…'));
});
