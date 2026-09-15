import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseCrop, clampCrop, centred, coverSize, containSize, type CropRel } from '../src/lib/cropmath.ts';
import { coverCrop, containCrop } from '../src/lib/printrender.ts';

/** Deterministic randomness — on a failure the case can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
}

test('Server side and browser side compute the same thing (cover)', () => {
  const r = rng(20260821);
  for (let i = 0; i < 20000; i++) {
    const natW = 1 + Math.floor(r() * 8000);
    const natH = 1 + Math.floor(r() * 8000);
    const aspect = 0.05 + r() * 20;
    const server = coverCrop(natW, natH, aspect);            // printrender.ts → PDF
    const browser = baseCrop(natW, natH, aspect, 'cover');   // cropmath.ts → preview
    assert.deepEqual(browser, server, `cover ${natW}x${natH} @ ${aspect}`);
  }
});

test('Server side and browser side compute the same thing (contain)', () => {
  const r = rng(7);
  for (let i = 0; i < 20000; i++) {
    const natW = 1 + Math.floor(r() * 8000);
    const natH = 1 + Math.floor(r() * 8000);
    const aspect = 0.05 + r() * 20;
    assert.deepEqual(baseCrop(natW, natH, aspect, 'contain'), containCrop(natW, natH, aspect),
      `contain ${natW}x${natH} @ ${aspect}`);
  }
});

test('cover stays inside the image, contain encloses the whole image', () => {
  const r = rng(99);
  const EPS = 1e-9;
  for (let i = 0; i < 20000; i++) {
    const natW = 1 + Math.floor(r() * 6000);
    const natH = 1 + Math.floor(r() * 6000);
    const aspect = 0.05 + r() * 20;

    const c = baseCrop(natW, natH, aspect, 'cover');
    assert.ok(c.x >= -EPS && c.y >= -EPS && c.x + c.w <= 1 + EPS && c.y + c.h <= 1 + EPS,
      `cover sticks out: ${JSON.stringify(c)}`);

    const k = baseCrop(natW, natH, aspect, 'contain');
    assert.ok(k.x <= EPS && k.y <= EPS && k.x + k.w >= 1 - EPS && k.y + k.h >= 1 - EPS,
      `contain does not enclose: ${JSON.stringify(k)}`);
  }
});

test('The aspect ratio is exact — otherwise the image would be distorted', () => {
  const r = rng(4242);
  for (let i = 0; i < 20000; i++) {
    const natW = 1 + Math.floor(r() * 6000);
    const natH = 1 + Math.floor(r() * 6000);
    const aspect = 0.05 + r() * 20;
    for (const fit of ['cover', 'contain'] as const) {
      const c = baseCrop(natW, natH, aspect, fit);
      // The crop measured in pixels has to have exactly the target ratio.
      const actual = (c.w * natW) / (c.h * natH);
      assert.ok(Math.abs(actual - aspect) < 1e-9,
        `${fit} ${natW}x${natH}: ratio ${actual} instead of ${aspect}`);
    }
  }
});

test('When the ratio already matches, the crop is the whole image', () => {
  for (const [w, h] of [[3000, 2000], [1000, 1000], [350, 450]]) {
    for (const fit of ['cover', 'contain'] as const) {
      assert.deepEqual(baseCrop(w, h, w / h, fit), { x: 0, y: 0, w: 1, h: 1 }, `${w}x${h} ${fit}`);
    }
  }
});

test('Switching the size keeps the centre of the crop', () => {
  // The user moved the crop to the top left, then switches from 3:2 to 35x45.
  const before: CropRel = { x: 0.1, y: 0.05, w: 0.4, h: 0.4 };
  const after = baseCrop(3000, 2000, 35 / 45, 'cover', before);
  const centreBefore = before.x + before.w / 2;
  const centreAfter = after.x + after.w / 2;
  // On the constrained axis the stop can take hold — but it may only move the
  // centre towards the image, not beyond it.
  assert.ok(Math.abs(centreAfter - centreBefore) < 0.5, `centre jumped: ${centreBefore} → ${centreAfter}`);
  assert.ok(after.x >= 0 && after.x + after.w <= 1);
});

test('clampCrop keeps cover inside the image and lets contain stick out in a controlled way', () => {
  assert.deepEqual(clampCrop({ x: -5, y: -5, w: 0.5, h: 0.5 }, 'cover'), { x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.deepEqual(clampCrop({ x: 5, y: 5, w: 0.5, h: 0.5 }, 'cover'), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  // contain: at least 5% of the crop has to stay inside the image.
  const far = clampCrop({ x: -99, y: -99, w: 2, h: 2 }, 'contain');
  assert.ok(far.x + far.w > 0 && far.y + far.h > 0, 'motif pushed completely out of the frame');
});

test('centred lays the crop around a centre point', () => {
  assert.deepEqual(centred(0.5, 0.5), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual(centred(0.2, 0.2, { x: 0, y: 0, w: 1, h: 1 }), { x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
});

test('coverSize and containSize are inverse to each other in ratio', () => {
  const c = coverSize(3000, 2000, 0.5), k = containSize(3000, 2000, 0.5);
  assert.ok(c.w <= 1 + 1e-9 && c.h <= 1 + 1e-9, 'cover must not go above 1');
  assert.ok(k.w >= 1 - 1e-9 || k.h >= 1 - 1e-9, 'contain has to fill at least one edge');
});
