// Machine-readable provenance marking for AI-generated images.
//
// Why: the EU AI Act (Art. 50) requires AI-generated content to be marked as
// such **in machine-readable form**. The `.md` sidecar file that Klarbild ships
// along is good documentation for people — but it is not a marking in the sense
// of the regulation. The established route is the IPTC field `DigitalSourceType`
// with the value `trainedAlgorithmicMedia`, embedded as XMP directly in the file.
// (This does not replace legal advice; it implements what is standard and common
// practice.)
//
// Deliberately **without a new dependency**: sharp 0.33 cannot write XMP, and
// upgrading the native library just for that would be a deployment risk (see the
// learnings about `tsx`). Hooking XMP into PNG and JPEG is cleanly specified in
// both cases and done in a few lines — and therefore testable as well.

// The identifier ends with a null byte, as the standard requires. Written as an
// escape: as a raw control character in the source file a formatter or an editor
// would turn it into a space — and then no tool would recognise the segment as
// XMP any more, and no test would catch it.
const XMP_NS = 'http://ns.adobe.com/xap/1.0/\u0000';
const BOM = '﻿';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The IPTC code for "created by a trained algorithm". */
export const TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

/** For images that a model only *changed* (clean up, cut out). */
export const COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia';

export interface Provenance {
  /** IPTC code, see the constants above. */
  sourceType: string;
  /** Model used, e.g. `google/gemini-3-pro-image`. */
  model?: string | null;
  /** Short description of what was done. */
  description?: string | null;
  /** Time of creation. */
  created?: Date;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The XMP packet as text — what is about to go into the file. */
export function buildXmp(p: Provenance): string {
  const created = (p.created ?? new Date()).toISOString();
  const tool = p.model ? `Klarbild (${p.model})` : 'Klarbild';
  const desc = p.description
    ? `\n    <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(p.description)}</rdf:li></rdf:Alt></dc:description>`
    : '';
  return `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Klarbild">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    Iptc4xmpExt:DigitalSourceType="${esc(p.sourceType)}"
    xmp:CreatorTool="${esc(tool)}"
    xmp:CreateDate="${created}">${desc}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/* ---------------- PNG ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a PNG chunk: length · type · data · CRC over type+data. */
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Hang the XMP in as an `iTXt` chunk behind the IHDR chunk. The PNG
 * specification requires text chunks to stand before the first `IDAT` — directly
 * behind IHDR is the safe spot.
 */
function embedPng(buf: Buffer, xmp: string): Buffer {
  // 8 bytes of signature, then IHDR: 4 length + 4 type + data + 4 CRC
  const ihdrLen = buf.readUInt32BE(8);
  const insertAt = 8 + 4 + 4 + ihdrLen + 4;
  const data = Buffer.concat([
    Buffer.from('XML:com.adobe.xmp', 'latin1'),
    // null byte · compression 0 · method 0 · language "" · translated keyword ""
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.from(xmp, 'utf8'),
  ]);
  return Buffer.concat([buf.subarray(0, insertAt), pngChunk('iTXt', data), buf.subarray(insertAt)]);
}

/* ---------------- JPEG ---------------- */

/**
 * Hook the XMP in as an `APP1` segment. An existing APP0 (JFIF) and an existing
 * APP1 (Exif, written by sharp for the dpi) stay in front of it — the two are
 * told apart by their identifier, they do not get in each other's way.
 */
function embedJpeg(buf: Buffer, xmp: string): Buffer {
  let pos = 2;                                       // behind SOI (FFD8)
  while (pos + 4 <= buf.length && buf[pos] === 0xff) {
    const marker = buf[pos + 1];
    if (marker !== 0xe0 && marker !== 0xe1) break;    // only skip APP0/APP1
    pos += 2 + buf.readUInt16BE(pos + 2);
  }
  const payload = Buffer.concat([Buffer.from(XMP_NS, 'latin1'), Buffer.from(xmp, 'utf8')]);
  const len = payload.length + 2;
  if (len > 0xffff) return buf;                      // does not fit into one segment — then rather nothing at all
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(len, 2);
  return Buffer.concat([buf.subarray(0, pos), head, payload, buf.subarray(pos)]);
}

/**
 * Write the marking into the image file. Recognises PNG and JPEG by itself.
 * For anything else (or on an error) the buffer comes back unchanged — a missing
 * marking is annoying, a broken image would be worse.
 */
export function embedProvenance(buf: Buffer, p: Provenance): Buffer {
  try {
    // Remove a marking that is already there instead of appending a second one:
    // otherwise the **older** model entry would stand in front, and reading
    // tools would take exactly that one. For a marking under Art. 50 AI Act,
    // though, the model actually used last is what should stand there.
    const clean = stripXmp(buf);
    const xmp = buildXmp(p);
    if (clean.subarray(0, 8).equals(PNG_MAGIC)) return embedPng(clean, xmp);
    if (clean[0] === 0xff && clean[1] === 0xd8) return embedJpeg(clean, xmp);
    return clean;
  } catch {
    return buf;
  }
}

/** Remove existing XMP packets (PNG iTXt or JPEG APP1). */
export function stripXmp(buf: Buffer): Buffer {
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) {
    const parts: Buffer[] = [buf.subarray(0, 8)];
    let pos = 8;
    while (pos + 12 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);
      const end = pos + 12 + len;
      if (end > buf.length) break;
      const isXmp = type === 'iTXt'
        && buf.toString('latin1', pos + 8, pos + 8 + 17) === 'XML:com.adobe.xmp';
      if (!isXmp) parts.push(buf.subarray(pos, end));
      pos = end;
      if (type === 'IEND') break;
    }
    return Buffer.concat(parts);
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const parts: Buffer[] = [buf.subarray(0, 2)];
    let pos = 2;
    while (pos + 4 <= buf.length && buf[pos] === 0xff) {
      const marker = buf[pos + 1];
      if (marker === 0xda) break;                       // from here on come the image data
      const len = buf.readUInt16BE(pos + 2);
      const end = pos + 2 + len;
      if (end > buf.length) break;
      const isXmp = marker === 0xe1
        && buf.toString('latin1', pos + 4, pos + 4 + XMP_NS.length) === XMP_NS;
      if (!isXmp) parts.push(buf.subarray(pos, end));
      pos = end;
    }
    parts.push(buf.subarray(pos));
    return Buffer.concat(parts);
  }
  return buf;
}

/** Reads the marking back out — for tests and for checking. */
export function readXmp(buf: Buffer): string | null {
  const i = buf.indexOf('<x:xmpmeta');
  if (i < 0) return null;
  const j = buf.indexOf('</x:xmpmeta>', i);
  return j < 0 ? null : buf.subarray(i, j + 12).toString('utf8');
}
