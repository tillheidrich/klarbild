// Crop mathematics — **with no dependencies at all**, like printlayout.ts.
//
// This file exists because the same calculation used to sit in the project twice:
// once in the browser (preview and crop window in PrintApp.tsx) and once on the
// server (printrender.ts, for the PDF). Both did the same arithmetic — but
// nothing held them against each other. Two copies of the same formula drift
// apart sooner or later, and then the preview shows something other than what
// gets printed. Now there is only one source, and a test holds the server entry
// point against the browser entry point.
//
// All crops are **relative** (0…1 with respect to the source image) and therefore
// independent of resolution: the same crop applies to the small preview image as
// to the original.

export interface CropRel { x: number; y: number; w: number; h: number }
export type FitMode = 'cover' | 'contain';

/** Largest crop in the target ratio that lies **inside** the image. */
export function coverSize(natW: number, natH: number, aspect: number): { w: number; h: number } {
  const imgA = natW / natH;
  return imgA > aspect ? { w: aspect / imgA, h: 1 } : { w: 1, h: imgA / aspect };
}

/**
 * Smallest crop in the target ratio that contains the **whole** image.
 * It deliberately reaches beyond the edge of the image (w or h > 1) — that is
 * where the letterbox area appears.
 */
export function containSize(natW: number, natH: number, aspect: number): { w: number; h: number } {
  const imgA = natW / natH;
  return imgA > aspect ? { w: 1, h: imgA / aspect } : { w: aspect / imgA, h: 1 };
}

/** Put it around the same centre point as an existing crop (otherwise centred). */
export function centred(w: number, h: number, around?: CropRel | null): CropRel {
  const cx = around ? around.x + around.w / 2 : 0.5;
  const cy = around ? around.y + around.h / 2 : 0.5;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Limits for zooming in and out. */
export interface CropLimits { min?: number; max?: number }

/**
 * Keeps the crop within sensible limits.
 * With `cover` it stays inside the image. With `contain` it may reach beyond —
 * but not so far that nothing of the subject would be visible any more (at least
 * 5 % has to stay inside the frame).
 *
 * `min`/`max` limit how far the user may zoom in and out. The **initial** crop
 * has to be exempt from that: a very tall image in a very wide size arithmetically
 * needs more than eight times — and a very wide size from a very tall image less
 * than 2 %. If the limit bit there, the aspect ratio would no longer be right, and
 * the image would be cropped after all even though "letterbox" is selected.
 * `baseCrop` therefore widens the limits to whatever the size actually needs.
 */
export function clampCrop(c: CropRel, fit: FitMode = 'cover', limits: CropLimits = {}): CropRel {
  const lo = limits.min ?? 0.02;
  const hi = limits.max ?? 8;
  if (fit === 'contain') {
    const w = Math.min(hi, Math.max(lo, c.w));
    const h = Math.min(hi, Math.max(lo, c.h));
    return {
      w, h,
      x: Math.min(1 - 0.05 * w, Math.max(-w + 0.05 * w, c.x)),
      y: Math.min(1 - 0.05 * h, Math.max(-h + 0.05 * h, c.y)),
    };
  }
  const w = Math.min(Math.min(1, hi), Math.max(lo, c.w));
  const h = Math.min(Math.min(1, hi), Math.max(lo, c.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)) };
}

/** Limits that are guaranteed to let a given initial crop through. */
export const limitsFor = (c: { w: number; h: number }): CropLimits =>
  ({ min: Math.min(0.02, c.w, c.h), max: Math.max(8, c.w, c.h) });

/**
 * The crop an image starts out with in a target size.
 * `around` preserves the centre point of the image if the user had already
 * panned and then switches the size.
 */
export function baseCrop(
  natW: number, natH: number, aspect: number, fit: FitMode = 'cover', around?: CropRel | null,
): CropRel {
  const { w, h } = fit === 'contain' ? containSize(natW, natH, aspect) : coverSize(natW, natH, aspect);
  // The zoom limits must never deform the initial crop — otherwise the aspect
  // ratio would be gone and it would be cropped after all (see clampCrop).
  return clampCrop(centred(w, h, around), fit, limitsFor({ w, h }));
}
