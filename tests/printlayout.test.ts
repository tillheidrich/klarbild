import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, capacity, cutMarks, effectiveGap, recommendedGap, dpiCheck, type SheetSpec } from '../src/lib/printlayout.ts';
import { parseSizeMm, mmToPx, mmToPt, paperById, photoById, labelMm } from '../src/lib/paper.ts';
import { fitsOnSheet, overflowPlacement, tilePlan, tileCrop, tileSheet, noteInset } from '../src/lib/printoversize.ts';

const A4: SheetSpec = { wMm: 210, hMm: 297, marginMm: 5, gapMm: 12, bleedMm: 0, center: true };

test('parseSizeMm understands the shorthand people actually type', () => {
  assert.deepEqual(parseSizeMm('12x15'), { w: 120, h: 150 });
  assert.deepEqual(parseSizeMm('12 × 15 cm'), { w: 120, h: 150 });
  assert.deepEqual(parseSizeMm('35x45mm'), { w: 35, h: 45 });
  assert.deepEqual(parseSizeMm('5'), { w: 50, h: 50 });
  assert.deepEqual(parseSizeMm('4,5x6'), { w: 45, h: 60 });
  // a:b is width:height — "4:3" is landscape, "3:4" is portrait.
  assert.deepEqual(parseSizeMm('4:3 / 15'), { w: 150, h: 112.5 });
  assert.deepEqual(parseSizeMm('3:4 / 15'), { w: 112.5, h: 150 });
  assert.deepEqual(parseSizeMm('16:9/30'), { w: 300, h: 168.75 });
  assert.equal(parseSizeMm('nonsense'), null);
  assert.equal(parseSizeMm('9999x1'), null);
});

test('mm → px is exact (proof of the printed size)', () => {
  assert.equal(mmToPx(100, 300), 1181);              // 10 cm
  assert.equal(mmToPx(150, 300), 1772);              // 15 cm
  assert.equal(mmToPx(300, 300), 3543);              // 30 cm → like a 30×40 poster
  assert.equal(mmToPx(400, 300), 4724);
  assert.equal(mmToPx(35, 300), 413);                // passport photo
  assert.equal(Math.round(mmToPt(210) * 100) / 100, 595.28); // A4 in pt
});

test('Passport photo sheet: 35×45 mm on A4 gives 20 pieces', () => {
  assert.equal(capacity({ id: 'p', wMm: 35, hMm: 45, allowRotate: false }, A4), 20);
});

test('Placements do not overlap and stay inside the type area', () => {
  const sheet: SheetSpec = { ...A4, gapMm: 6 };
  const res = layout([
    { id: 'a', wMm: 90, hMm: 130, count: 2 },
    { id: 'b', wMm: 35, hMm: 45, count: 6 },
  ], sheet);
  assert.ok(res.pages.length >= 1);
  for (const pg of res.pages) {
    for (const p of pg.placements) {
      assert.ok(p.x >= sheet.marginMm - 1e-6, 'left margin');
      assert.ok(p.y >= sheet.marginMm - 1e-6, 'top margin');
      assert.ok(p.x + p.w <= sheet.wMm - sheet.marginMm + 1e-6, 'right margin');
      assert.ok(p.y + p.h <= sheet.hMm - sheet.marginMm + 1e-6, 'bottom margin');
    }
    for (let i = 0; i < pg.placements.length; i++)
      for (let j = i + 1; j < pg.placements.length; j++) {
        const a = pg.placements[i], b = pg.placements[j];
        const overlap = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6
                     && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
        assert.ok(!overlap, `overlap ${a.specId}#${a.copy} / ${b.specId}#${b.copy}`);
      }
  }
});

test('The gap keeps the bleed of neighbouring cells apart', () => {
  const sheet: SheetSpec = { ...A4, gapMm: 1, bleedMm: 3 };
  assert.equal(effectiveGap(sheet), 6);
  const res = layout([{ id: 'a', wMm: 50, hMm: 50, count: 4 }], { ...sheet, gapMm: effectiveGap(sheet) });
  const row = res.pages[0].placements.filter((p) => Math.abs(p.y - res.pages[0].placements[0].y) < 1e-6)
    .sort((a, b) => a.x - b.x);
  assert.ok(row.length >= 2);
  assert.ok(row[1].x - (row[0].x + row[0].w) >= 6 - 1e-6);
});

test('Corner marks lie outside the trimmed size', () => {
  const res = layout([{ id: 'a', wMm: 90, hMm: 130, count: 1 }], A4);
  const pg = res.pages[0];
  const lines = cutMarks(pg, A4, { mode: 'corner', lengthMm: 4, offsetMm: 3 });
  assert.equal(lines.length, 8, '4 corners × 2 marks');
  const p = pg.placements[0];
  for (const l of lines) {
    const inside = (x: number, y: number) =>
      x > p.x + 1e-6 && x < p.x + p.w - 1e-6 && y > p.y + 1e-6 && y < p.y + p.h - 1e-6;
    assert.ok(!inside(l.x1, l.y1) && !inside(l.x2, l.y2), 'mark reaches into the image');
  }
});

test('Continuous lines do not run through other images', () => {
  const sheet: SheetSpec = { ...A4, gapMm: 4 };
  const res = layout([{ id: 'a', wMm: 60, hMm: 80, count: 6 }], sheet);
  const pg = res.pages[0];
  const lines = cutMarks(pg, sheet, { mode: 'grid' });
  assert.ok(lines.length > 0);
  for (const l of lines) {
    for (const p of pg.placements) {
      const hitsX = Math.min(l.x1, l.x2) < p.x + p.w - 1e-3 && Math.max(l.x1, l.x2) > p.x + 1e-3;
      const hitsY = Math.min(l.y1, l.y2) < p.y + p.h - 1e-3 && Math.max(l.y1, l.y2) > p.y + 1e-3;
      assert.ok(!(hitsX && hitsY), 'line cuts through a motif');
    }
  }
});

test('An image that is too big lands in unplaced instead of nowhere', () => {
  const res = layout([{ id: 'big', wMm: 300, hMm: 400, count: 1 }], A4);
  assert.equal(res.pages.length, 0);
  assert.equal(res.unplaced[0].specId, 'big');
});

test('More than one sheet when the quantity does not fit', () => {
  const res = layout([{ id: 'a', wMm: 35, hMm: 45, count: 25 }], A4);
  assert.equal(res.pages.length, 2);
  assert.equal(res.pages[0].placements.length, 20);
  assert.equal(res.pages[1].placements.length, 5);
});

test('Rotating allows more images on 10×15 photo paper', () => {
  const photo: SheetSpec = { wMm: 100, hMm: 150, marginMm: 0, gapMm: 0, bleedMm: 0, center: true };
  const without = capacity({ id: 'x', wMm: 100, hMm: 50, allowRotate: false }, photo);
  const with_ = capacity({ id: 'x', wMm: 50, hMm: 100, allowRotate: true }, photo);
  assert.equal(without, 3);
  assert.ok(with_ >= 3);
});

test('The recommended gap makes room for the marks', () => {
  assert.equal(recommendedGap('corner', 0, 4, 3), 14);
  assert.equal(recommendedGap('none', 3), 6);
  assert.equal(recommendedGap('grid', 0), 0);
});

test('The dpi warning fires when the source is too small', () => {
  assert.equal(dpiCheck(1181, 100, 300).ok, true);
  assert.equal(dpiCheck(600, 100, 300).ok, false);
  assert.equal(dpiCheck(1181, 100, 300).dpi, 300);
});

test('The size tables are consistent', () => {
  assert.equal(paperById('A4')!.w, 210);
  assert.equal(paperById('A3plus')!.h, 483);
  assert.equal(photoById('P35x45')!.w, 35);
  assert.equal(photoById('S12x15')!.h, 150);
  assert.equal(labelMm(35, 45), '35 × 45 mm');
  assert.equal(labelMm(120, 150), '12 × 15 cm');
  // Decimal places must not fall away — the caption stands in the footer and in
  // the file name.
  assert.equal(labelMm(112.5, 150), '11.25 × 15 cm');
  assert.equal(labelMm(105, 148), '10.5 × 14.8 cm');
});

test('The chosen orientation stays when it does not cost extra sheets', () => {
  // A single passport photo must not be laid on its side just because more of
  // them would fit on the sheet that way.
  const res = layout([{ id: 'p', wMm: 35, hMm: 45, count: 1, allowRotate: true }], A4);
  assert.equal(res.pages[0].placements[0].rotated, false);
  assert.equal(res.pages[0].placements[0].w, 35);

  // 25 × 15 cm on portrait A4: lying flat it is too wide (250 > 200 mm of usable
  // width), rotated it fits — so it has to be rotated.
  const big = layout([{ id: 'g', wMm: 250, hMm: 150, count: 1, allowRotate: true }], A4);
  assert.equal(big.pages.length, 1);
  assert.equal(big.pages[0].placements[0].rotated, true);
  assert.equal(big.pages[0].placements[0].w, 150);

  // Without permission to rotate it stays flat and is reported as "does not fit".
  const stubborn = layout([{ id: 'g', wMm: 250, hMm: 150, count: 1, allowRotate: false }], A4);
  assert.equal(stubborn.pages.length, 0);
  assert.equal(stubborn.unplaced.length, 1);
});

/* --- Regressions from the code review of 18 August 2026 ---------------- */

test('Without an entry, rotating is allowed (allowRotate undefined)', () => {
  // Before, the image landed in "unplaced" because !!undefined === false.
  const res = layout([{ id: 'g', wMm: 250, hMm: 150, count: 1 }], A4);
  assert.equal(res.unplaced.length, 0);
  assert.equal(res.pages[0].placements[0].rotated, true);
});

test('Even with many sizes each one gets a fitting orientation', () => {
  // The "tooBig" emergency brake (>5 sizes) must not silently drop a size.
  const specs = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, wMm: 20, hMm: 30, count: 1, allowRotate: true }));
  specs.push({ id: 'g', wMm: 250, hMm: 150, count: 1, allowRotate: true });
  const res = layout(specs, { ...A4, gapMm: 4 });
  const placed = res.pages.flatMap((p) => p.placements).map((p) => p.specId);
  assert.ok(placed.includes('g'), 'the wide image has to be placed rotated');
  assert.equal(res.unplaced.length, 0);
});

test('unplaced names the image that is really missing', () => {
  const specs = [
    { id: 'small', wMm: 20, hMm: 30, count: 2, allowRotate: false },
    { id: 'huge', wMm: 250, hMm: 250, count: 3, allowRotate: false },
  ];
  const res = layout(specs, A4);
  assert.equal(res.unplaced.length, 1);
  assert.equal(res.unplaced[0].specId, 'huge');
  assert.equal(res.unplaced[0].count, 3);
});

test('Corner marks stay outside the printed area even with bleed', () => {
  const sheet: SheetSpec = { wMm: 210, hMm: 297, marginMm: 10, gapMm: 20, bleedMm: 5, center: true };
  const res = layout([{ id: 'a', wMm: 60, hMm: 80, count: 2, allowRotate: false }], sheet);
  const pg = res.pages[0];
  // The requested offset of 3 mm is too small for 5 mm of bleed — it has to be
  // raised.
  const lines = cutMarks(pg, sheet, { mode: 'corner', lengthMm: 4, offsetMm: 3, bleedMm: 5 });
  assert.ok(lines.length > 0);
  for (const l of lines) for (const p of pg.placements) {
    const inBleed = (x: number, y: number) =>
      x > p.x - 5 + 1e-6 && x < p.x + p.w + 5 - 1e-6 && y > p.y - 5 + 1e-6 && y < p.y + p.h + 5 - 1e-6;
    assert.ok(!inBleed(l.x1, l.y1) && !inBleed(l.x2, l.y2), 'mark lies inside the printed bleed');
  }
});

test('capacity no longer caps at 200', () => {
  const a2: SheetSpec = { wMm: 420, hMm: 594, marginMm: 5, gapMm: 0, bleedMm: 0, center: true };
  const n = capacity({ id: 'x', wMm: 20, hMm: 30, allowRotate: false }, a2);
  assert.equal(n, 20 * 19);
});

test('Degenerate quantities do not bring the packer to a halt', () => {
  const t0 = process.hrtime.bigint();
  const specs = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, wMm: 5 + (i % 5), hMm: 6 + (i % 4), count: 12, allowRotate: true }));
  const res = layout(specs, { wMm: 2000, hMm: 2000, marginMm: 0, gapMm: 0, bleedMm: 0, center: true });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(res.pages.length >= 1);
  assert.ok(ms < 4000, `packing took ${Math.round(ms)} ms — too long for the server process`);
});

/* --- Oversize images (20 × 30 on A4 & poster printing) ----------------- */

test('20 × 30 cm does not fit on A4 — but only by 3 mm', () => {
  const borderless: SheetSpec = { wMm: 210, hMm: 297, marginMm: 0, gapMm: 0, bleedMm: 0, center: true };
  assert.equal(fitsOnSheet(200, 300, borderless, false), false);
  const info = overflowPlacement('a', 1, 200, 300, borderless, false);
  assert.equal(info.rotated, false);
  assert.equal(info.lostLeft, 0);
  assert.equal(info.lostRight, 0);
  assert.equal(info.lostTop, 1.5);      // 300 − 297 = 3 mm, spread evenly
  assert.equal(info.lostBottom, 1.5);
  assert.equal(info.lostMm, 3);
  // centred: x = (210 − 200) / 2
  assert.equal(info.placement.x, 5);
  assert.equal(info.placement.y, -1.5);
});

test('An oversize image is rotated when less is lost that way', () => {
  const a4: SheetSpec = { wMm: 210, hMm: 297, marginMm: 0, gapMm: 0, bleedMm: 0, center: true };
  // 297 × 200 landscape: unrotated it runs 87 mm over the width, rotated it
  // almost fits.
  const info = overflowPlacement('a', 1, 297, 200, a4, true);
  assert.equal(info.rotated, true);
  assert.equal(info.lostMm, 0);
});

test('Poster print: 30 × 40 cm on A4 gives 2 × 2 sheets with a glue flap', () => {
  const a4: SheetSpec = { wMm: 210, hMm: 297, marginMm: 5, gapMm: 0, bleedMm: 0, center: true };
  const tp = tilePlan(300, 400, a4, 10);
  assert.equal(tp.cols, 2);
  assert.equal(tp.rows, 2);
  assert.equal(tp.tiles.length, 4);
  assert.equal(tp.overlapMm, 10);
  // The first tile fills the usable area, the last one carries the remainder.
  assert.equal(tp.tiles[0].wMm, 200);
  assert.equal(tp.tiles[0].hMm, 287);
  assert.ok(tp.tiles[0].glueRight && tp.tiles[0].glueBottom);
  assert.equal(tp.tiles[3].glueRight, false);
  assert.equal(tp.tiles[3].glueBottom, false);
  // The tiles cover the whole image (the right and bottom edges are reached).
  const maxX = Math.max(...tp.tiles.map((t) => t.xMm + t.wMm));
  const maxY = Math.max(...tp.tiles.map((t) => t.yMm + t.hMm));
  assert.ok(maxX >= 300 - 1e-6, `something is missing on the right: ${maxX}`);
  assert.ok(maxY >= 400 - 1e-6, `something is missing at the bottom: ${maxY}`);
});

test('Tiles really do overlap by the glue flap', () => {
  const a4: SheetSpec = { wMm: 210, hMm: 297, marginMm: 5, gapMm: 0, bleedMm: 0, center: true };
  const tp = tilePlan(300, 400, a4, 10);
  const left = tp.tiles.find((t) => t.col === 0 && t.row === 0)!;
  const right = tp.tiles.find((t) => t.col === 1 && t.row === 0)!;
  const overlap = (left.xMm + left.wMm) - right.xMm;
  assert.equal(Math.round(overlap * 10) / 10, 10);
});

test('A tile crop stays inside the crop the user chose', () => {
  const a4: SheetSpec = { wMm: 210, hMm: 297, marginMm: 5, gapMm: 0, bleedMm: 0, center: true };
  const tp = tilePlan(300, 400, a4, 10);
  const crop = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
  for (const t of tp.tiles) {
    const c = tileCrop(crop, t, 300, 400);
    assert.ok(c.x >= crop.x - 1e-9 && c.x + c.w <= crop.x + crop.w + 1e-9, 'broke out horizontally');
    assert.ok(c.y >= crop.y - 1e-9 && c.y + c.h <= crop.y + crop.h + 1e-9, 'broke out vertically');
  }
  // The first tile begins exactly where the crop begins.
  const first = tileCrop(crop, tp.tiles[0], 300, 400);
  assert.equal(Math.round(first.x * 1e6) / 1e6, crop.x);
  assert.equal(Math.round(first.y * 1e6) / 1e6, crop.y);
});

test('An image that fits does not count as oversize', () => {
  const a4: SheetSpec = { wMm: 210, hMm: 297, marginMm: 5, gapMm: 0, bleedMm: 0, center: true };
  assert.equal(fitsOnSheet(130, 180, a4, false), true);
  assert.equal(fitsOnSheet(250, 150, a4, true), true, 'rotated it fits');
  assert.equal(fitsOnSheet(250, 150, a4, false), false, 'unrotated it does not');
});

test('Poster print leaves room for the sheet number without running off the bottom', () => {
  const sheet: SheetSpec = { wMm: 210, hMm: 297, marginMm: 5, bleedMm: 0 };
  // A 5 mm margin is not enough for the 8 pt line — the tile moves down by 1 mm.
  assert.equal(noteInset(sheet), 1);
  const ts = tileSheet(sheet);
  const tp = tilePlan(300, 400, ts, 10);
  const top = (sheet.marginMm || 0) + noteInset(sheet);
  for (const t of tp.tiles) {
    assert.ok(top + t.hMm <= sheet.hMm + 1e-6,
      `tile ${t.row}/${t.col} runs off the bottom: ${top + t.hMm} > ${sheet.hMm}`);
    assert.ok((sheet.marginMm || 0) + t.wMm <= sheet.wMm + 1e-6);
  }
  // The tiles cover the trimmed size with no gaps.
  const right = Math.max(...tp.tiles.map((t) => t.xMm + t.wMm));
  const bottom = Math.max(...tp.tiles.map((t) => t.yMm + t.hMm));
  assert.ok(right >= 300 - 1e-6 && bottom >= 400 - 1e-6, `coverage ${right} × ${bottom}`);
});

test('A generous margin does not move the tile', () => {
  const sheet: SheetSpec = { wMm: 210, hMm: 297, marginMm: 10, bleedMm: 0 };
  assert.equal(noteInset(sheet), 0);
  assert.deepEqual(tileSheet(sheet), sheet);
});
