import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetFilename, buildSingleFilename, paperToken, filenameFromHeader, KLARBILD_NAME } from '../src/lib/naming.ts';

/**
 * Names for print files. The reason for these tests is the same one as in August
 * for the library images: two sheets from the same day had the same name, and
 * whoever put both into the same folder lost the first one.
 */

const AT = new Date('2026-09-01T12:32:07Z');   // 14:32:07 Berlin time

test('A sheet gets a timestamp, its contents, the paper and a short id', () => {
  const n = buildSheetFilename({ wMm: 210, hMm: 297, paperId: 'A4', pieces: 9, pages: 1, runId: '4eca6ec4-…', at: AT });
  assert.equal(n, '2026-09-01_143207_print-9-pieces_a4_4eca.pdf');
});

test('Two sheets from the same second cannot overwrite each other', () => {
  const a = buildSheetFilename({ wMm: 210, hMm: 297, paperId: 'A4', pieces: 9, pages: 1, runId: 'aaaa1111', at: AT });
  const b = buildSheetFilename({ wMm: 210, hMm: 297, paperId: 'A4', pieces: 9, pages: 1, runId: 'bbbb2222', at: AT });
  assert.notEqual(a, b, 'same second, same settings — different all the same');
});

test('One and many — singular, plural, number of sheets', () => {
  const one = buildSheetFilename({ wMm: 210, hMm: 297, paperId: 'A4', pieces: 1, pages: 1, runId: 'ab12', at: AT });
  assert.ok(one.includes('print-1-piece_'), one);
  const many = buildSheetFilename({ wMm: 329, hMm: 483, paperId: 'A3PLUS', pieces: 24, pages: 3, runId: 'ffff', at: AT });
  assert.equal(many, '2026-09-01_143207_print-24-pieces-3-sheets_a3plus_ffff.pdf');
});

test('A name of your own takes precedence and is made safe', () => {
  const n = buildSheetFilename({ name: 'Daycare Müller / set 2', wMm: 210, hMm: 297, paperId: 'A4', pieces: 4, pages: 1, runId: 'cccc', at: AT });
  assert.equal(n, '2026-09-01_143207_daycare-mueller-set-2_a4_cccc.pdf');
});

test('Unknown paper becomes the size', () => {
  assert.equal(paperToken(null, 100, 150), '100x150');
  assert.equal(paperToken('', 210, 297), '210x297');
  assert.equal(paperToken('A4', 210, 297), 'a4');
  // A very long identifier would bloat the name — then the size is the better choice.
  assert.equal(paperToken('an-extremely-long-identifier', 210, 297), '210x297');
});

test('Single images inherit the motif of their source', () => {
  const n = buildSingleFilename({ sourceName: '2026-08-31_221842_kombiniert_30x40_25b3.png', wMm: 130, hMm: 180, ext: 'jpg', id: '25b34b55-e816', at: AT });
  assert.equal(n, '2026-09-01_143207_kombiniert_130x180_25b3.jpg');
});

test('Without a usable motif it says "klarbild", not nothing', () => {
  assert.equal(buildSingleFilename({ sourceName: null, wMm: 35, hMm: 45, ext: 'jpg', id: 'aaaa', at: AT }),
    '2026-09-01_143207_klarbild_35x45_aaaa.jpg');
  assert.equal(buildSingleFilename({ sourceName: 'IMG_1234.HEIC', wMm: 35, hMm: 45, ext: 'jpg', id: 'bbbb', at: AT }),
    '2026-09-01_143207_img-1234_35x45_bbbb.jpg');
});

test('Sizes with decimals lose the point — otherwise it would look like an extension', () => {
  const n = buildSingleFilename({ sourceName: 'x.png', wMm: 150, hMm: 112.5, ext: 'png', id: 'dddd', at: AT });
  assert.equal(n, '2026-09-01_143207_x_150x112-5_dddd.png');
  assert.equal(n.split('.').length, 2, 'exactly one extension');
});

test('Print files follow the same pattern as library results', () => {
  for (const n of [
    buildSheetFilename({ wMm: 210, hMm: 297, paperId: 'A4', pieces: 9, pages: 1, runId: '4eca', at: AT }),
    buildSingleFilename({ sourceName: 'portrait.png', wMm: 130, hMm: 180, ext: 'jpg', id: '25b3', at: AT }),
  ]) {
    assert.ok(KLARBILD_NAME.test(n.replace(/\.[^.]+$/, '')), `does not fit the scheme: ${n}`);
  }
});

test('Names are usable on any file system', () => {
  for (const name of ['Grüße/Köln', 'a\\b:c*d?e"f<g>h|i', '../../..', 'x'.repeat(200)]) {
    const n = buildSheetFilename({ name, wMm: 210, hMm: 297, paperId: 'A4', pieces: 2, pages: 1, runId: 'eeee', at: AT });
    assert.ok(/^[a-z0-9_.-]+$/.test(n), `unexpected character: ${n}`);
    assert.ok(n.endsWith('.pdf'));
  }
});

test('The name comes from the server, not from the browser', () => {
  assert.equal(filenameFromHeader('attachment; filename="2026-09-01_143207_print-9-pieces_a4_4eca.pdf"', 'x.pdf'),
    '2026-09-01_143207_print-9-pieces_a4_4eca.pdf');
  assert.equal(filenameFromHeader("attachment; filename*=UTF-8''gr%C3%BC%C3%9Fe.pdf", 'x.pdf'), 'grüße.pdf');
  assert.equal(filenameFromHeader(null, 'x.pdf'), 'x.pdf');
  assert.equal(filenameFromHeader('attachment', 'x.pdf'), 'x.pdf');
});

test('A name from the header cannot smuggle in a path', () => {
  for (const evil of ['attachment; filename="../../etc/passwd"', 'attachment; filename="a/b.pdf"',
                      'attachment; filename="a\\\\b.pdf"', 'attachment; filename=".hidden"']) {
    const n = filenameFromHeader(evil, 'x.pdf');
    assert.ok(!n.includes('/') && !n.includes('\\') && !n.startsWith('.'), `path survived: ${n}`);
  }
});

test('ZIPs from the library are not all called the same', async () => {
  const { buildSelectionZipName } = await import('../src/lib/naming.ts');
  const a = buildSelectionZipName(12, AT);
  assert.match(a, /^2026-09-01_143207_selection-12-images_[0-9a-f]{4}\.zip$/);
  assert.equal(buildSelectionZipName(1, AT).includes('selection-1-image_'), true);
  // Two selections in the same second: the short id tells them apart.
  const pairs = new Set(Array.from({ length: 50 }, () => buildSelectionZipName(12, AT)));
  assert.ok(pairs.size > 40, `too many identical names: ${pairs.size}/50`);
});
