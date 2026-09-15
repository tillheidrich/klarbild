// Oversize images: what to do when the trim size is larger than the sheet?
// 20 × 30 cm on A4 photo paper is the everyday case — exactly 3 mm are missing.
// Pure mathematics, no dependencies (like printlayout.ts), so that browser and
// server use the same calculation.
import type { Placement, SheetSpec } from './printlayout.ts';

const EPS = 1e-6;
const round = (n: number) => Math.round(n * 1000) / 1000;

export type Oversize =
  | 'fit'       // do nothing, report it as "does not fit" (default)
  | 'overflow'  // place it centred on the sheet, the oversize is cut off in printing
  | 'tile';     // spread it over several sheets (poster print, to be glued together)

/** Does the trim size fit onto the usable area of the sheet — rotated if need be? */
export function fitsOnSheet(wMm: number, hMm: number, sheet: SheetSpec, allowRotate = true): boolean {
  const inset = (sheet.marginMm || 0) + (sheet.bleedMm || 0);
  const availW = sheet.wMm - 2 * inset, availH = sheet.hMm - 2 * inset;
  const plain = wMm <= availW + EPS && hMm <= availH + EPS;
  const rot = allowRotate && hMm <= availW + EPS && wMm <= availH + EPS;
  return plain || rot;
}

export interface OverflowInfo {
  /** Placement on the sheet — may be negative, in which case the image reaches beyond. */
  placement: Placement;
  rotated: boolean;
  /** How much is lost per side (mm), worked out after rotating. */
  lostLeft: number; lostRight: number; lostTop: number; lostBottom: number;
  lostMm: number;
}

/**
 * Place an image that is too large centred on the **whole sheet** — deliberately
 * not on the usable area, because otherwise you give away the margin that a
 * borderless printer can very well print on. Whatever reaches beyond the sheet is
 * missing afterwards; how much, is in `lost*`.
 */
export function overflowPlacement(
  specId: string, copy: number, wMm: number, hMm: number, sheet: SheetSpec, allowRotate = true,
): OverflowInfo {
  const loss = (w: number, h: number) => Math.max(0, w - sheet.wMm) + Math.max(0, h - sheet.hMm);
  const rotated = !!allowRotate && loss(hMm, wMm) < loss(wMm, hMm) - EPS;
  const w = rotated ? hMm : wMm, h = rotated ? wMm : hMm;

  const x = round((sheet.wMm - w) / 2), y = round((sheet.hMm - h) / 2);
  const lostLeft = round(Math.max(0, -x)), lostTop = round(Math.max(0, -y));
  const lostRight = round(Math.max(0, x + w - sheet.wMm));
  const lostBottom = round(Math.max(0, y + h - sheet.hMm));
  return {
    placement: { specId, copy, x, y, w, h, rotated },
    rotated, lostLeft, lostRight, lostTop, lostBottom,
    lostMm: round(lostLeft + lostRight + lostTop + lostBottom),
  };
}

/**
 * In a poster print every sheet carries "Sheet 2/4 · row 1, column 2" — that is
 * the assembly instruction and is therefore always printed (8 pt from 3 mm below
 * the top edge, needs about 6 mm). If the paper margin is tighter than that, the
 * tile has to move down accordingly; so that it does not stick out at the bottom,
 * the sheet is calculated correspondingly lower. Browser and server use the same
 * function, otherwise the preview would show a different number of sheets than
 * the finished PDF.
 */
export const NOTE_MM = 6;
export function noteInset(sheet: SheetSpec): number {
  return Math.max(0, NOTE_MM - (sheet.marginMm || 0));
}
export function tileSheet(sheet: SheetSpec): SheetSpec {
  const n = noteInset(sheet);
  return n ? { ...sheet, hMm: sheet.hMm - n } : sheet;
}

export interface Tile {
  col: number; row: number;          // 0-based
  xMm: number; yMm: number;          // section of the target image, from the top left corner
  wMm: number; hMm: number;
  glueRight: boolean; glueBottom: boolean;   // a neighbouring tile joins on there
}

export interface TilePlan { cols: number; rows: number; tiles: Tile[]; overlapMm: number }

/**
 * Poster print: spread one image over several sheets.
 * The tiles overlap by `overlapMm` — that strip is the glue flap. It is printed
 * on both neighbouring sheets; when assembling, you lay the one sheet onto the
 * other along the dashed line.
 */
export function tilePlan(wMm: number, hMm: number, sheet: SheetSpec, overlapMm = 10): TilePlan {
  const inset = sheet.marginMm || 0;
  const availW = Math.max(10, sheet.wMm - 2 * inset);
  const availH = Math.max(10, sheet.hMm - 2 * inset);
  const o = Math.max(0, Math.min(overlapMm, Math.min(availW, availH) / 3));

  const stepX = Math.max(1, availW - o), stepY = Math.max(1, availH - o);
  const cols = Math.max(1, Math.ceil((wMm - o) / stepX));
  const rows = Math.max(1, Math.ceil((hMm - o) / stepY));

  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * stepX, y = r * stepY;
      const w = Math.min(availW, wMm - x), h = Math.min(availH, hMm - y);
      if (w <= 0.5 || h <= 0.5) continue;
      tiles.push({
        col: c, row: r, xMm: round(x), yMm: round(y), wMm: round(w), hMm: round(h),
        glueRight: c < cols - 1, glueBottom: r < rows - 1,
      });
    }
  }
  return { cols, rows, tiles, overlapMm: round(o) };
}

/** The section of one tile, nested inside the user's crop. */
export function tileCrop(
  crop: { x: number; y: number; w: number; h: number },
  tile: Tile, wMm: number, hMm: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: crop.x + (tile.xMm / wMm) * crop.w,
    y: crop.y + (tile.yMm / hMm) * crop.h,
    w: (tile.wMm / wMm) * crop.w,
    h: (tile.hMm / hMm) * crop.h,
  };
}
