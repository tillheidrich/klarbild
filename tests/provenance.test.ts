import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  buildXmp, embedProvenance, readXmp,
  TRAINED_ALGORITHMIC_MEDIA, COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA,
  stripXmp,
} from '../src/lib/provenance.ts';

const image = (w = 240, h = 160) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c8463c' } });

test('The XMP packet carries the IPTC code and the model', () => {
  const xmp = buildXmp({ sourceType: TRAINED_ALGORITHMIC_MEDIA, model: 'google/gemini-3-pro-image' });
  assert.match(xmp, /Iptc4xmpExt:DigitalSourceType="http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/trainedAlgorithmicMedia"/);
  assert.match(xmp, /xmp:CreatorTool="Klarbild \(google\/gemini-3-pro-image\)"/);
  assert.match(xmp, /<x:xmpmeta/);
});

test('Special characters in the prompt do not take the XML apart', () => {
  const xmp = buildXmp({
    sourceType: TRAINED_ALGORITHMIC_MEDIA,
    description: 'Ada & Grace <b>"large"</b> — 3 < 5',
  });
  assert.ok(!xmp.includes('<b>'), 'unescaped tag in the XMP');
  assert.match(xmp, /Ada &amp; Grace/);
  // Exactly as many opening as closing brackets of the elements we know about.
  assert.equal((xmp.match(/<rdf:Description/g) || []).length, 1);
  assert.equal((xmp.match(/<\/rdf:Description>/g) || []).length, 1);
});

for (const [name, make] of [
  ['PNG', async () => image().png().toBuffer()],
  ['JPEG', async () => image().jpeg().toBuffer()],
  ['JPEG with dpi metadata (as in a job)', async () => image().withMetadata({ density: 300 }).jpeg({ quality: 92 }).toBuffer()],
] as const) {
  test(`${name}: the marking is written and the image stays intact`, async () => {
    const before = await make();
    const after = embedProvenance(before, {
      sourceType: TRAINED_ALGORITHMIC_MEDIA, model: 'test/model', description: 'Test run',
    });
    assert.ok(after.length > before.length, 'nothing embedded');

    // 1) The marking can be read back …
    const xmp = readXmp(after);
    assert.ok(xmp, 'XMP not found');
    assert.match(xmp!, /trainedAlgorithmicMedia/);

    // 2) … and sharp still reads the file, with unchanged measurements.
    const m = await sharp(after).metadata();
    const m0 = await sharp(before).metadata();
    assert.equal(m.width, m0.width);
    assert.equal(m.height, m0.height);
    assert.equal(m.format, m0.format);
    if (m0.density) assert.equal(m.density, m0.density, 'dpi lost');

    // 3) The pixels themselves are untouched.
    const a = await sharp(before).raw().toBuffer();
    const b = await sharp(after).raw().toBuffer();
    assert.ok(a.equals(b), 'the image content has changed');
  });
}

test('Cleaned-up photos get the code for altered material', () => {
  const xmp = buildXmp({ sourceType: COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA });
  assert.match(xmp, /compositeWithTrainedAlgorithmicMedia/);
});

test('Unknown formats and junk come back unchanged', () => {
  for (const b of [Buffer.from('not an image'), Buffer.alloc(0), Buffer.from([0x52, 0x49, 0x46, 0x46])]) {
    assert.ok(embedProvenance(b, { sourceType: TRAINED_ALGORITHMIC_MEDIA }).equals(b));
  }
});

test('Marking twice does not break the file', async () => {
  const png = await image().png().toBuffer();
  const once = embedProvenance(png, { sourceType: TRAINED_ALGORITHMIC_MEDIA });
  const twice = embedProvenance(once, { sourceType: TRAINED_ALGORITHMIC_MEDIA });
  const m = await sharp(twice).metadata();
  assert.equal(m.width, 240);
});

test('The APP1 identifier ends on a real null byte (otherwise no tool recognises it)', async () => {
  const jpg = embedProvenance(await image().jpeg().toBuffer(), { sourceType: TRAINED_ALGORITHMIC_MEDIA });
  const i = jpg.indexOf('http://ns.adobe.com/xap/1.0/');
  assert.ok(i > 0, 'identifier not found');
  assert.equal(jpg[i + 28], 0x00, 'the identifier does not end on 0x00');
});

test('Marking twice replaces the old entry instead of appending a second one', async () => {
  for (const [name, make] of [
    ['PNG', async () => image().png().toBuffer()],
    ['JPEG', async () => image().jpeg().toBuffer()],
  ] as const) {
    const raw = await make();
    const old = embedProvenance(raw, { sourceType: TRAINED_ALGORITHMIC_MEDIA, model: 'old/model' });
    const fresh = embedProvenance(old, { sourceType: TRAINED_ALGORITHMIC_MEDIA, model: 'new/model' });

    // Exactly **one** packet, and it is the new one.
    const packets = fresh.toString('latin1').split('<x:xmpmeta').length - 1;
    assert.equal(packets, 1, `${name}: ${packets} XMP packets instead of one`);
    assert.match(readXmp(fresh)!, /new\/model/, `${name}: wrong model`);
    assert.ok(!readXmp(fresh)!.includes('old/model'), `${name}: the old model is still there`);

    // And the image is still intact.
    const m = await sharp(fresh).metadata();
    assert.equal(m.width, 240, `${name}: measurements changed`);
    assert.ok((await sharp(raw).raw().toBuffer()).equals(await sharp(fresh).raw().toBuffer()),
      `${name}: image content changed`);
  }
});

test('stripXmp leaves files without a marking untouched', async () => {
  const png = await image().png().toBuffer();
  assert.ok(stripXmp(png).equals(png));
  const jpg = await image().jpeg().toBuffer();
  assert.ok(stripXmp(jpg).equals(jpg));
});
