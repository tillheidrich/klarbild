// Rendering the print sheet: crop (sharp) + PDF assembly (pdf-lib).
// Deliberately without AI — plain geometry and scaling, so that the result is
// predictable and repeatable.
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { mmToPt, mmToPx } from './paper.ts';
import type { Line, Page, SheetSpec } from './printlayout.ts';
import { baseCrop, type CropRel, type FitMode } from './cropmath.ts';

/** Crop relative to the source (0..1) — storable independently of resolution. */
export type { CropRel, FitMode };

export const FULL_CROP: CropRel = { x: 0, y: 0, w: 1, h: 1 };

/* `FitMode`: `cover` = crop until filled (something is missing at the outside),
   `contain` = fit the whole image in (the letterbox colour stays at the outside).
   Never distort. */

/** Largest centred crop in the target ratio — fills it out, cuts something off. */
// Both entry points calculate via `src/lib/cropmath.ts` — the same file the
// browser preview uses. `tests/cropmath.test.ts` holds the two routes against
// each other, so that preview and PDF cannot drift apart.
export const coverCrop = (natW: number, natH: number, aspect: number): CropRel =>
  baseCrop(natW, natH, aspect, 'cover');

/**
 * Smallest crop in the target ratio that contains the **whole** image.
 * It deliberately reaches beyond the edge of the image (w or h > 1) — that is
 * where the letterbox area appears.
 */
export const containCrop = (natW: number, natH: number, aspect: number): CropRel =>
  baseCrop(natW, natH, aspect, 'contain');

/**
 * Brings a section of an image to an exact physical size.
 * `bleedMm` enlarges the rendered field outwards; the trim box stays exactly the
 * chosen section. Missing edge pixels are continued from the edge
 * (extendWith 'copy') instead of squashing the subject.
 */
export async function renderCell(
  input: Buffer,
  crop: CropRel | null,
  wMm: number,
  hMm: number,
  dpi: number,
  opt: { rotate?: boolean; ext?: 'jpg' | 'png'; bleedMm?: number; background?: string; fit?: FitMode } = {},
): Promise<{ buffer: Buffer; width: number; height: number; ext: 'jpg' | 'png'; srcPx: [number, number] }> {
  const bleed = Math.max(0, opt.bleedMm || 0);
  const fit: FitMode = opt.fit === 'contain' ? 'contain' : 'cover';
  const bg = /^#[0-9a-fA-F]{6}$/.test(opt.background || '') ? opt.background! : '#ffffff';

  // Apply the EXIF orientation BEFORE anything is calculated. Phone photos carry
  // the rotation only as metadata; browsers and the iPhone show them rotated,
  // while sharp without this step calculates on the unrotated raster — and then
  // the image comes out of the printer sideways and with the wrong crop.
  const meta0 = await sharp(input, { failOn: 'none' }).metadata();
  const src = (meta0.orientation ?? 1) > 1
    ? await sharp(input, { failOn: 'none' }).rotate().toBuffer()
    : input;

  const meta = (meta0.orientation ?? 1) > 1 ? await sharp(src, { failOn: 'none' }).metadata() : meta0;
  const nw = meta.width || 0, nh = meta.height || 0;
  if (!nw || !nh) throw new Error('Image dimensions unknown.');

  const c = crop ? normCrop(crop, fit) : (fit === 'contain'
    ? containCrop(nw, nh, wMm / hMm)
    : coverCrop(nw, nh, wMm / hMm));

  // Bleed: widen the crop from the centre, so that the trim box stays exactly
  // the framed area.
  const fx = (wMm + 2 * bleed) / wMm;
  const fy = (hMm + 2 * bleed) / hMm;
  const cw = c.w * fx, ch = c.h * fy;
  const cx = c.x - (cw - c.w) / 2, cy = c.y - (ch - c.h) / 2;

  const targetW = mmToPx(wMm + 2 * bleed, dpi);
  const targetH = mmToPx(hMm + 2 * bleed, dpi);
  if (targetW * targetH > MAX_TARGET_PX)
    throw new Error(`Target image too large (${targetW}×${targetH} px). Please reduce the size or the resolution.`);

  // Visible part of the crop (the rest is filled, not rendered).
  const vx0 = Math.max(cx, 0), vy0 = Math.max(cy, 0);
  const vx1 = Math.min(cx + cw, 1), vy1 = Math.min(cy + ch, 1);
  if (vx1 - vx0 <= 0 || vy1 - vy0 <= 0) throw new Error('Crop lies outside the image.');

  const L = clampInt(Math.round(vx0 * nw), 0, nw - 1);
  const T = clampInt(Math.round(vy0 * nh), 0, nh - 1);
  const W = clampInt(Math.round((vx1 - vx0) * nw), 1, nw - L);
  const H = clampInt(Math.round((vy1 - vy0) * nh), 1, nh - T);

  // Mapping crop → target image (scale in px per fraction of the crop).
  const sx = targetW / (cw * nw), sy = targetH / (ch * nh);
  let dx = clampInt(Math.round((vx0 - cx) * nw * sx), 0, targetW - 1);
  let dy = clampInt(Math.round((vy0 - cy) * nh * sy), 0, targetH - 1);
  const dw = clampInt(Math.round(W * sx), 1, targetW - dx);
  const dh = clampInt(Math.round(H * sy), 1, targetH - dy);
  const right = targetW - dx - dw, bottom = targetH - dy - dh;

  // A single sharp chain: extract → resize → extend. That order is sharp's own
  // internal order, which is why the numbers add up. Important: only pad after
  // scaling down, otherwise the intermediate image grows beyond all measure.
  let img = sharp(src, { failOn: 'none' })
    .extract({ left: L, top: T, width: W, height: H })
    .resize(dw, dh, { fit: 'fill' });
  if (dx || dy || right || bottom) {
    img = img.extend(fit === 'contain'
      ? { top: dy, left: dx, bottom, right, background: bg }
      : { top: dy, left: dx, bottom, right, extendWith: 'copy' });
  }

  const hasAlpha = !!meta.hasAlpha;
  const ext: 'jpg' | 'png' = opt.ext === 'png' || hasAlpha ? 'png' : 'jpg';
  if (hasAlpha && ext === 'jpg') img = img.flatten({ background: bg });

  const encode = (pipe: sharp.Sharp) => (ext === 'png'
    ? pipe.withMetadata({ density: dpi }).png({ compressionLevel: 9 })
    : pipe.withMetadata({ density: dpi }).jpeg({ quality: 94, mozjpeg: true }));

  // Rotate only in the second pass: otherwise sharp would apply a rotation
  // before the padding and put the margins on the wrong sides.
  let out = await (opt.rotate ? img.png({ compressionLevel: 0 }) : encode(img))
    .toBuffer({ resolveWithObject: true });
  if (opt.rotate) out = await encode(sharp(out.data, { failOn: 'none' }).rotate(90))
    .toBuffer({ resolveWithObject: true });

  return { buffer: out.data, width: out.info.width, height: out.info.height, ext, srcPx: [nw, nh] };
}

/** Upper bound for the target image — guards against a memory explosion from extreme size/dpi combinations. */
const MAX_TARGET_PX = 300_000_000;

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n | 0));

function normCrop(c: CropRel | null, fit: FitMode = 'cover'): CropRel {
  if (!c) return FULL_CROP;
  const num = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
  // When letterboxing, the crop may be larger than the image (that is where the
  // letterbox area appears); when cropping it has to lie inside the image.
  const maxSide = fit === 'contain' ? 8 : 1;
  const w = Math.min(maxSide, Math.max(0.001, num(c.w, 1)));
  const h = Math.min(maxSide, Math.max(0.001, num(c.h, 1)));
  if (fit === 'contain') {
    // Only prevent the image from being pushed completely out of the crop.
    const x = Math.min(1 - 0.05 * w, Math.max(-w + 0.05 * w, num(c.x)));
    const y = Math.min(1 - 0.05 * h, Math.max(-h + 0.05 * h, num(c.y)));
    return { x, y, w, h };
  }
  const x = Math.min(1 - w, Math.max(0, num(c.x)));
  const y = Math.min(1 - h, Math.max(0, num(c.y)));
  return { x, y, w, h };
}

export interface SheetCellImage { bytes: Buffer; ext: 'jpg' | 'png' }

/** Where the footer sits. The edge first, the alignment second.
 *  The values stay as they are — they cross the wire in the API request body. */
export type FooterPos =
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
  | 'top-left'  | 'top-center'  | 'top-rechts';

export interface FooterSpec { text: string; position?: FooterPos; sizePt?: number }

/** Extras per page — for the poster print: sheet number and glue flap. */
export interface PageExtras { note?: string | null; dashed?: Line[] }

export interface SheetPdfInput {
  sheet: SheetSpec;
  pages: Page[];
  marksPerPage: Line[][];
  /** specId → finished rendered image (bleed included, rotated if applicable). */
  images: Record<string, SheetCellImage>;
  title?: string;
  footer?: FooterSpec | null;
  extrasPerPage?: PageExtras[];
  markWidthPt?: number;
}

/**
 * Builds the print PDF. Page size = sheet size in mm, 1:1 — when printing, be
 * sure to choose "Actual size / 100 %", not "fit to page".
 */
export async function buildSheetPdf(input: SheetPdfInput): Promise<Uint8Array> {
  const { sheet, pages, marksPerPage, images } = input;
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title || 'Klarbild print sheet');
  pdf.setProducer('Klarbild');
  pdf.setCreator('Klarbild — print sheet');

  const embedded: Record<string, any> = {};
  for (const [id, img] of Object.entries(images)) {
    embedded[id] = img.ext === 'png' ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
  }
  const needsFont = !!input.footer || (input.extrasPerPage || []).some((e) => e?.note);
  const font = needsFont ? await pdf.embedFont(StandardFonts.Helvetica) : null;
  const bleed = sheet.bleedMm || 0;
  const W = mmToPt(sheet.wMm), H = mmToPt(sheet.hMm);

  pages.forEach((pg, i) => {
    const page = pdf.addPage([W, H]);
    for (const p of pg.placements) {
      const im = embedded[p.specId];
      if (!im) continue;
      // Image including bleed: reaches beyond the trim box by `bleed` per side.
      const x = mmToPt(p.x - bleed);
      const yTop = p.y - bleed;                       // counted from the top
      const w = mmToPt(p.w + 2 * bleed);
      const h = mmToPt(p.h + 2 * bleed);
      page.drawImage(im, { x, y: H - mmToPt(yTop) - h, width: w, height: h });
    }
    for (const l of marksPerPage[i] || []) {
      page.drawLine({
        start: { x: mmToPt(l.x1), y: H - mmToPt(l.y1) },
        end: { x: mmToPt(l.x2), y: H - mmToPt(l.y2) },
        thickness: input.markWidthPt ?? 0.25,
        color: rgb(0, 0, 0),
      });
    }
    // Glue flaps in the poster print: dashed, so that nobody mistakes them for a
    // cut edge.
    const extras = input.extrasPerPage?.[i];
    for (const l of extras?.dashed || []) {
      page.drawLine({
        start: { x: mmToPt(l.x1), y: H - mmToPt(l.y1) },
        end: { x: mmToPt(l.x2), y: H - mmToPt(l.y2) },
        thickness: 0.4, color: rgb(0.55, 0.55, 0.52), dashArray: [4, 3],
      });
    }

    if (font) {
      const put = (text: string, pos: FooterPos, size: number) => {
        const w = font.widthOfTextAtSize(text, size);
        const top = pos.startsWith('top');
        const y = top ? H - mmToPt(3) - size : mmToPt(3);
        const x = pos.endsWith('center') ? (W - w) / 2
          : pos.endsWith('rechts') ? W - mmToPt(4) - w
          : mmToPt(4);
        page.drawText(text, { x, y, size, font, color: rgb(0.45, 0.45, 0.42), rotate: degrees(0) });
      };

      // The footer only if there really is room at the chosen edge —
      // otherwise it would sit in the middle of the subject.
      if (input.footer?.text) {
        const pos = input.footer.position || 'bottom-left';
        const size = input.footer.sizePt ?? 6;
        const top = pos.startsWith('top');
        const free = pg.placements.length
          ? (top ? Math.min(...pg.placements.map((p) => p.y - bleed))
                 : sheet.hMm - Math.max(...pg.placements.map((p) => p.y + p.h + bleed)))
          : sheet.hMm;
        if (free >= size * 0.353 + 4) put(input.footer.text, pos, size);
      }
      // The sheet number in a poster print is always there — it is the assembly instruction.
      if (extras?.note) put(extras.note, 'top-left', 8);
    }
  });

  return pdf.save();
}
