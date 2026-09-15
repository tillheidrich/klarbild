import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderCell, coverCrop, containCrop } from '../src/lib/printrender.ts';
import { mmToPx } from '../src/lib/paper.ts';

/** A 3:2 landscape graphic with clearly recognisable edges. */
async function testImage(w = 1200, h = 800): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 90, b: 220 } } })
    .png().toBuffer();
}

test('Cropping gives exactly the target size — with bleed too', async () => {
  const img = await testImage();
  for (const bleed of [0, 3]) {
    const out = await renderCell(img, null, 35, 45, 300, { ext: 'png', fit: 'cover', bleedMm: bleed });
    assert.equal(out.width, mmToPx(35 + 2 * bleed, 300));
    assert.equal(out.height, mmToPx(45 + 2 * bleed, 300));
  }
});

test('Letterboxing gives exactly the target size and lays down the background colour', async () => {
  const img = await testImage();
  for (const bleed of [0, 3]) {
    const out = await renderCell(img, null, 35, 45, 300, { ext: 'png', fit: 'contain', bleedMm: bleed, background: '#000000' });
    assert.equal(out.width, mmToPx(35 + 2 * bleed, 300), 'width');
    assert.equal(out.height, mmToPx(45 + 2 * bleed, 300), 'height');
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const top = at(Math.round(info.width / 2), 3);
    const centre = at(Math.round(info.width / 2), Math.round(info.height / 2));
    assert.deepEqual(top, [0, 0, 0], 'the top has to be the background colour');
    assert.ok(centre[2] > 150, 'the image has to stand in the middle');
  }
});

test('Cropping fills the size completely (no margin)', async () => {
  const img = await testImage();
  const out = await renderCell(img, null, 35, 45, 300, { ext: 'png', fit: 'cover', background: '#000000' });
  const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  for (const [x, y] of [[3, 3], [info.width - 4, 3], [3, info.height - 4], [info.width - 4, info.height - 4]])
    assert.ok(at(x, y)[2] > 150, 'the corners carry image too');
});

test('A landscape target from a portrait source keeps its measurements', async () => {
  const img = await testImage(800, 1200);
  const out = await renderCell(img, null, 150, 100, 300, { ext: 'jpg', fit: 'contain', background: '#ffffff' });
  assert.equal(out.width, mmToPx(150, 300));
  assert.equal(out.height, mmToPx(100, 300));
});

test('The rotated version swaps width and height', async () => {
  const img = await testImage();
  const out = await renderCell(img, null, 90, 130, 300, { ext: 'png', rotate: true });
  assert.equal(out.width, mmToPx(130, 300));
  assert.equal(out.height, mmToPx(90, 300));
});

test('The cover and contain crops compute in opposite directions', () => {
  const a = 35 / 45;                       // portrait target
  const cov = coverCrop(1200, 800, a);     // landscape image
  const con = containCrop(1200, 800, a);
  assert.ok(cov.w < 1 && cov.h === 1, 'cover cuts away at the sides');
  assert.ok(con.h > 1 && con.w === 1, 'contain sticks out at the top and bottom');
  assert.ok(con.y < 0, 'the oversize lies outside the image');
});

test('A crop is taken over exactly (no silent re-centring)', async () => {
  // Colour the top left corner red, then crop exactly that corner.
  const base = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer(), left: 0, top: 0 }])
    .png().toBuffer();
  const out = await renderCell(base, { x: 0, y: 0, w: 0.2, h: 0.2 }, 50, 50, 300, { ext: 'png' });
  const { data } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 200 && data[2] < 60, 'the chosen crop has to be red');
});

/* --- Regressions from the code review of 18 August 2026 ---------------- */

test('EXIF rotation is applied — phone photos do not come out sideways', async () => {
  const landscape = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .composite([{ input: await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer(), left: 0, top: 0 }])
    .jpeg().toBuffer();
  const withExif = await sharp(landscape).withMetadata({ orientation: 6 }).jpeg().toBuffer();

  const auto = await sharp(await sharp(withExif).rotate().toBuffer()).metadata();
  const out = await renderCell(withExif, null, 90, 130, 300, { ext: 'png' });
  // renderCell has to compute with the pixel grid that the browser shows.
  assert.deepEqual(out.srcPx, [auto.width, auto.height]);
});

test('Extreme crops do not blow up memory and still give the target size', async () => {
  const panorama = await sharp({ create: { width: 6000, height: 1500, channels: 3, background: { r: 20, g: 80, b: 200 } } }).jpeg().toBuffer();
  for (const [w, h] of [[105, 148], [5, 400]] as [number, number][]) {
    const out = await renderCell(panorama, null, w, h, 300, { ext: 'jpg', fit: 'contain', background: '#000000' });
    assert.equal(out.width, mmToPx(w, 300));
    assert.equal(out.height, mmToPx(h, 300));
  }
  // A crop far outside the image: only background colour around it, no huge buffer.
  const far = await renderCell(panorama, { x: -3.5, y: -3.5, w: 8, h: 8 }, 35, 45, 300, { ext: 'png', fit: 'contain', background: '#000000' });
  assert.equal(far.width, mmToPx(35, 300));
  assert.equal(far.height, mmToPx(45, 300));
});

test('The rotated version with bleed keeps its measurements', async () => {
  const img = await testImage();
  const out = await renderCell(img, null, 90, 130, 300, { ext: 'png', rotate: true, bleedMm: 3 });
  assert.equal(out.width, mmToPx(130 + 6, 300));
  assert.equal(out.height, mmToPx(90 + 6, 300));
});

test('Bleed enlarges the cell without moving the crop', async () => {
  // A colour gradient, so that every position has a colour of its own.
  const w = 1000, h = 1000;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    px[i] = Math.round((x / w) * 255); px[i + 1] = Math.round((y / h) * 255); px[i + 2] = 128;
  }
  const img = await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const crop = { x: 0.2, y: 0.3, w: 0.5, h: 0.4 };

  const centre = async (bleed: number) => {
    const out = await renderCell(img, crop, 50, 40, 300, { ext: 'png', bleedMm: bleed });
    const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true });
    // Centre of the trim box = centre of the image (the bleed lies symmetrically
    // around the outside).
    const i = (Math.round(info.height / 2) * info.width + Math.round(info.width / 2)) * info.channels;
    return [data[i], data[i + 1]];
  };
  const a = await centre(0), b = await centre(5);
  assert.ok(Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2,
    `the centre of the trim box moves with bleed: ${a} vs ${b}`);
});
