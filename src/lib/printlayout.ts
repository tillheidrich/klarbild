// Pure layout mathematics for the print sheet — mm, no I/O, no dependencies.
// Used identically by the preview in the browser and by the PDF renderer on the
// server, so that "what I see" and "what gets printed" are the same calculation.
//
// Coordinates: origin at the top left, x to the right, y downwards (as on screen/SVG).
// The PDF renderer mirrors y, because PDF counts from the bottom left.

export interface PlaceSpec {
  id: string;          // points at an image
  wMm: number;         // trim size (trim box) width
  hMm: number;         // trim size height
  count: number;       // how many times onto the paper
  allowRotate?: boolean;
}

export interface SheetSpec {
  wMm: number;
  hMm: number;
  marginMm: number;    // the printer's non-printable margin (safety margin)
  gapMm: number;       // distance between two trim sizes
  bleedMm?: number;    // bleed per side (the image reaches beyond)
  center?: boolean;    // centre the block on the sheet (default: true)
}

export interface Placement {
  specId: string;
  copy: number;        // 1-based
  x: number; y: number; // top left corner of the trim box
  w: number; h: number; // trim box
  rotated: boolean;     // image placed rotated by 90°
}

export interface Line { x1: number; y1: number; x2: number; y2: number }

export interface Page { placements: Placement[] }

export interface LayoutResult {
  pages: Page[];
  /** What does not fit on any sheet (e.g. image larger than the paper). */
  unplaced: { specId: string; count: number; reason: string }[];
  perSheet: number;     // pieces on the first sheet (a figure for the UI)
}

export type MarkMode = 'none' | 'corner' | 'grid';

const EPS = 1e-6;

/** Effective gap: the bleeds of two neighbours must not overlap. */
export function effectiveGap(sheet: SheetSpec): number {
  return Math.max(sheet.gapMm || 0, 2 * (sheet.bleedMm || 0));
}

/**
 * Packs the trim sizes onto as few sheets as possible.
 *
 * Two routes, deliberately kept apart:
 *  1. All images the same size → exact grid (columns × rows). Perfectly
 *     aligned, so that continuous cut lines really do run through.
 *  2. Mixed sizes              → MaxRects (best-short-side-fit) with optional
 *     90° rotation. This is the case "one large image plus eight passport
 *     photos": the small ones move into the leftover area next to the large one.
 *
 * The gap is carried along as an "inflated" rectangle (image + gap), which is
 * why the spacing is right everywhere, including at the edge.
 */
export function layout(specs: PlaceSpec[], sheet: SheetSpec): LayoutResult {
  const gap = effectiveGap(sheet);
  const bleed = sheet.bleedMm || 0;
  const inset = (sheet.marginMm || 0) + bleed;
  const availW = sheet.wMm - 2 * inset;
  const availH = sheet.hMm - 2 * inset;

  const unplaced: LayoutResult['unplaced'] = [];
  const units: { specId: string; copy: number; w: number; h: number; rot: boolean }[] = [];

  for (const s of specs) {
    const n = Math.max(0, Math.floor(s.count || 0));
    if (!n) continue;
    const fitsPlain = s.wMm <= availW + EPS && s.hMm <= availH + EPS;
    const fitsRot = s.allowRotate !== false && s.hMm <= availW + EPS && s.wMm <= availH + EPS;
    if (!fitsPlain && !fitsRot) {
      unplaced.push({ specId: s.id, count: n, reason: 'larger than the usable area of the sheet' });
      continue;
    }
    for (let c = 1; c <= n; c++) units.push({ specId: s.id, copy: c, w: s.wMm, h: s.hMm, rot: false });
  }
  if (!units.length) return { pages: [], unplaced, perSheet: 0 };

  const uniform = units.every((u) => Math.abs(u.w - units[0].w) < EPS && Math.abs(u.h - units[0].h) < EPS);
  let pages: Page[];

  if (uniform) {
    pages = gridPack(units, specs, availW, availH, gap);
  } else {
    // Decide the orientation per image size (not per copy) — otherwise identical
    // images end up lying every which way on the sheet. Try all sensible
    // combinations and take the best one.
    const ids = [...new Set(units.map((u) => u.specId))];
    const rotatable = ids.filter((id) => {
      const sp = specs.find((s) => s.id === id)!;
      return sp.allowRotate !== false && Math.abs(sp.wMm - sp.hMm) > EPS;
    });
    const tooBig = ids.length > 5 || units.length > 150;
    // With very many sizes/pieces, do not try every combination — but still give
    // every size an orientation in which it fits at all.
    const variants: Record<string, boolean>[] = tooBig
      ? [Object.fromEntries(ids.map((id) => {
          const sp = specs.find((x) => x.id === id)!;
          const plainFits = sp.wMm <= availW + EPS && sp.hMm <= availH + EPS;
          return [id, !plainFits && sp.allowRotate !== false];
        }))]
      : combos(rotatable).map((set) => Object.fromEntries(ids.map((id) => [id, set.has(id)])));

    let best: Page[] | null = null, bestScore = -Infinity;
    for (const [vi, rotMap] of variants.entries()) {
      const oriented = units.map((u) => {
        const r = !!rotMap[u.specId];
        const sp = specs.find((s) => s.id === u.specId)!;
        // Only allow orientations that fit onto the sheet at all.
        const w = r ? sp.hMm : sp.wMm, h = r ? sp.wMm : sp.hMm;
        return { ...u, w, h, rot: r };
      });
      if (oriented.some((u) => u.w > availW + EPS || u.h > availH + EPS)) continue;
      const cand = maxRectsPack(oriented, availW, availH, gap);
      const placed = cand.reduce((n, p) => n + p.placements.length, 0);
      if (placed < units.length) continue;
      // Few sheets counts for most, then a full first page, then "as little
      // rotated as possible" (the orientation the user asked for is more likely
      // to survive).
      const score = -cand.length * 1000 + (cand[0]?.placements.length || 0) - 0.01 * vi
        - 0.1 * Object.values(rotMap).filter(Boolean).length;
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    pages = best || maxRectsPack(units.map((u) => ({ ...u, rot: false })), availW, availH, gap);
    // Count the missing pieces per image size — do not blame them all on the first one.
    const placedKeys = new Set(pages.flatMap((pg) => pg.placements.map((pl) => `${pl.specId}#${pl.copy}`)));
    const missing = new Map<string, number>();
    for (const u of units) if (!placedKeys.has(`${u.specId}#${u.copy}`)) missing.set(u.specId, (missing.get(u.specId) || 0) + 1);
    for (const [id, n] of missing) unplaced.push({ specId: id, count: n, reason: 'no room on the sheet' });
  }

  // Align on the sheet: centre of the block, or top left corner.
  for (const pg of pages) {
    let offX = inset, offY = inset;
    if (sheet.center !== false && pg.placements.length) {
      const minX = Math.min(...pg.placements.map((p) => p.x));
      const maxX = Math.max(...pg.placements.map((p) => p.x + p.w));
      const minY = Math.min(...pg.placements.map((p) => p.y));
      const maxY = Math.max(...pg.placements.map((p) => p.y + p.h));
      offX = inset + (availW - (maxX - minX)) / 2 - minX;
      offY = inset + (availH - (maxY - minY)) / 2 - minY;
    }
    for (const p of pg.placements) { p.x = round(p.x + offX); p.y = round(p.y + offY); }
  }

  return { pages, unplaced, perSheet: pages[0]?.placements.length || 0 };
}

/** Images of equal size: a clean grid, row by row. */
function gridPack(units: { specId: string; copy: number; w: number; h: number }[], specs: PlaceSpec[],
                  availW: number, availH: number, gap: number): Page[] {
  const spec = specs.find((s) => s.id === units[0].specId);
  let { w, h } = units[0];
  let rot = false;
  const fit = (a: number, b: number) => ({
    cols: Math.max(0, Math.floor((availW + gap + EPS) / (a + gap))),
    rows: Math.max(0, Math.floor((availH + gap + EPS) / (b + gap))),
  });
  // The orientation chosen by the user takes precedence. It is rotated only if
  // that actually lowers the number of sheets (or if nothing fits unrotated).
  let best = fit(w, h);
  if (spec?.allowRotate !== false && Math.abs(w - h) > EPS) {
    const alt = fit(h, w);
    const plainN = best.cols * best.rows, altN = alt.cols * alt.rows;
    const pages = (n: number) => (n > 0 ? Math.ceil(units.length / n) : Infinity);
    if (pages(altN) < pages(plainN)) { best = alt; [w, h] = [h, w]; rot = true; }
  }
  const perPage = best.cols * best.rows;
  if (!perPage) return [];

  const pages: Page[] = [];
  for (let i = 0; i < units.length; i += perPage) {
    const chunk = units.slice(i, i + perPage);
    const placements: Placement[] = chunk.map((u, k) => {
      const c = k % best.cols, r = Math.floor(k / best.cols);
      return { specId: u.specId, copy: u.copy, x: round(c * (w + gap)), y: round(r * (h + gap)), w, h, rotated: rot };
    });
    pages.push({ placements });
  }
  return pages;
}

interface FreeRect { x: number; y: number; w: number; h: number }

/** Mixed sizes: MaxRects with best-short-side-fit, orientation already decided. */
function maxRectsPack(units: { specId: string; copy: number; w: number; h: number; rot: boolean }[],
                      availW: number, availH: number, gap: number): Page[] {
  // Large ones first — otherwise the small pieces block the good areas.
  const todo = [...units].sort((a, b) =>
    (b.w * b.h) - (a.w * a.h) || Math.max(b.w, b.h) - Math.max(a.w, a.h) ||
    a.specId.localeCompare(b.specId) || a.copy - b.copy);

  const W = availW + gap, H = availH + gap;   // inflated area
  const pages: Page[] = [];
  // Emergency brake against degenerate input (many sizes × many pieces): the
  // packer runs synchronously in the server process and must not block it.
  let steps = 0;
  const MAX_STEPS = 2_000_000;

  while (todo.length) {
    let free: FreeRect[] = [{ x: 0, y: 0, w: W, h: H }];
    const placements: Placement[] = [];

    for (;;) {
      let bestIdx = -1, bestScore = Infinity, bestAlt = Infinity;
      let bestRect: FreeRect | null = null;

      for (let i = 0; i < todo.length; i++) {
        const u = todo[i];
        const cw = u.w + gap, ch = u.h + gap;
        if ((steps += free.length) > MAX_STEPS) break;
        for (const r of free) {
          if (cw > r.w + EPS || ch > r.h + EPS) continue;
          const short = Math.min(r.w - cw, r.h - ch);
          // On a tie, take the area furthest to the top/left — that gives a
          // calm, readable sheet instead of scattered subjects.
          const pos = r.y * 10000 + r.x;
          if (short < bestScore - EPS || (Math.abs(short - bestScore) < EPS && pos < bestAlt - EPS)) {
            bestScore = short; bestAlt = pos; bestIdx = i; bestRect = r;
          }
        }
      }
      if (bestIdx < 0 || !bestRect || steps > MAX_STEPS) break;

      const u = todo.splice(bestIdx, 1)[0];
      placements.push({ specId: u.specId, copy: u.copy, x: round(bestRect.x), y: round(bestRect.y), w: u.w, h: u.h, rotated: u.rot });
      free = splitFree(free, { x: bestRect.x, y: bestRect.y, w: u.w + gap, h: u.h + gap });
    }

    if (!placements.length) break;               // nothing placeable → stop
    placements.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push({ placements });
    if (pages.length > 200 || steps > MAX_STEPS) break;   // emergency brake
  }
  return pages;
}

/** All subsets (orientation combinations), stably sorted. */
function combos(ids: string[]): Set<string>[] {
  const out: Set<string>[] = [];
  const n = Math.min(ids.length, 8);
  for (let m = 0; m < (1 << n); m++) {
    const s = new Set<string>();
    for (let i = 0; i < n; i++) if (m & (1 << i)) s.add(ids[i]);
    out.push(s);
  }
  // First "nothing rotated", then ascending by number of rotations.
  return out.sort((a, b) => a.size - b.size);
}

function splitFree(free: FreeRect[], used: FreeRect): FreeRect[] {
  const out: FreeRect[] = [];
  for (const r of free) {
    const overlap = used.x < r.x + r.w - EPS && used.x + used.w > r.x + EPS
                 && used.y < r.y + r.h - EPS && used.y + used.h > r.y + EPS;
    if (!overlap) { out.push(r); continue; }
    if (used.x > r.x + EPS) out.push({ x: r.x, y: r.y, w: used.x - r.x, h: r.h });
    if (used.x + used.w < r.x + r.w - EPS) out.push({ x: used.x + used.w, y: r.y, w: r.x + r.w - (used.x + used.w), h: r.h });
    if (used.y > r.y + EPS) out.push({ x: r.x, y: r.y, w: r.w, h: used.y - r.y });
    if (used.y + used.h < r.y + r.h - EPS) out.push({ x: r.x, y: used.y + used.h, w: r.w, h: r.y + r.h - (used.y + used.h) });
  }
  // Throw away rectangles contained in others (otherwise the list grows without bound).
  return out.filter((a, i) => a.w > EPS && a.h > EPS && !out.some((b, j) =>
    j !== i && b.x <= a.x + EPS && b.y <= a.y + EPS &&
    b.x + b.w >= a.x + a.w - EPS && b.y + b.h >= a.y + a.h - EPS &&
    (b.w > a.w + EPS || b.h > a.h + EPS || j < i)));
}

/** How many trim sizes fit onto one sheet at most? (A figure for the UI.) */
export function capacity(spec: Omit<PlaceSpec, 'count'>, sheet: SheetSpec): number {
  // Calculate directly instead of packing — otherwise the trial run caps the answer.
  const gap = effectiveGap(sheet);
  const inset = (sheet.marginMm || 0) + (sheet.bleedMm || 0);
  const availW = sheet.wMm - 2 * inset, availH = sheet.hMm - 2 * inset;
  const grid = (w: number, h: number) =>
    Math.max(0, Math.floor((availW + gap + EPS) / (w + gap))) *
    Math.max(0, Math.floor((availH + gap + EPS) / (h + gap)));
  const plain = grid(spec.wMm, spec.hMm);
  const rot = spec.allowRotate !== false ? grid(spec.hMm, spec.wMm) : 0;
  return Math.max(plain, rot);
}

export interface MarkOptions {
  mode: MarkMode;
  lengthMm?: number;   // length of one mark (standard: 4–10 mm)
  offsetMm?: number;   // distance outwards from the trim size
  bleedMm?: number;
}

/**
 * Crop marks as line segments.
 * - `corner`: four pairs of corner marks per image, outside the trim size (the
 *             Adobe / print-shop convention).
 * - `grid`:   continuous lines across the whole sheet at every cut edge — for the
 *             cutting rule or the guillotine, when there are many identical
 *             images on the sheet.
 */
export function cutMarks(page: Page, sheet: SheetSpec, opt: MarkOptions): Line[] {
  if (opt.mode === 'none') return [];
  const len = opt.lengthMm ?? 4;
  // The offset has to clear the printed bleed — otherwise the mark lands on the
  // subject. A requested value that is too small is therefore raised.
  const off = Math.max(opt.offsetMm ?? 0, (opt.bleedMm ?? 0) + 1, 2);
  const lines: Line[] = [];

  if (opt.mode === 'corner') {
    for (const p of page.placements) {
      const L = p.x, R = p.x + p.w, T = p.y, B = p.y + p.h;
      // per corner: one horizontal and one vertical mark, pointing outwards
      for (const [x, y, sx, sy] of [[L, T, -1, -1], [R, T, 1, -1], [L, B, -1, 1], [R, B, 1, 1]] as const) {
        lines.push({ x1: x + sx * off, y1: y, x2: x + sx * (off + len), y2: y });
        lines.push({ x1: x, y1: y + sy * off, x2: x, y2: y + sy * (off + len) });
      }
    }
    return clip(lines, sheet);
  }

  // grid: draw the cut edges across the whole sheet — but only where no other
  // image is in the way. Otherwise the line would run right through the
  // neighbouring subject.
  const xs = uniq(page.placements.flatMap((p) => [p.x, p.x + p.w]));
  const ys = uniq(page.placements.flatMap((p) => [p.y, p.y + p.h]));
  for (const x of xs) {
    const blocked = page.placements
      .filter((p) => p.x + EPS < x && x < p.x + p.w - EPS)
      .map((p) => [p.y, p.y + p.h] as [number, number]);
    for (const [a, b] of complement(blocked, 0, sheet.hMm)) lines.push({ x1: x, y1: a, x2: x, y2: b });
  }
  for (const y of ys) {
    const blocked = page.placements
      .filter((p) => p.y + EPS < y && y < p.y + p.h - EPS)
      .map((p) => [p.x, p.x + p.w] as [number, number]);
    for (const [a, b] of complement(blocked, 0, sheet.wMm)) lines.push({ x1: a, y1: y, x2: b, y2: y });
  }
  return lines.filter((l) => Math.abs(l.x2 - l.x1) > 0.2 || Math.abs(l.y2 - l.y1) > 0.2);
}

const uniq = (ns: number[]) => [...new Set(ns.map(round))].sort((a, b) => a - b);

/** Free stretches in [from,to] after subtracting the occupied intervals. */
function complement(blocked: [number, number][], from: number, to: number): [number, number][] {
  const sorted = [...blocked].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = from;
  for (const [a, b] of sorted) {
    if (a > cur) out.push([cur, Math.min(a, to)]);
    cur = Math.max(cur, b);
    if (cur >= to) break;
  }
  if (cur < to) out.push([cur, to]);
  return out.filter(([a, b]) => b - a > 0.2);
}

/**
 * Smallest gap at which the chosen marks still make sense:
 * the corner marks of two neighbours each need (offset + length) of room, and
 * bleeds must not overlap.
 */
export function recommendedGap(mode: MarkMode, bleedMm = 0, lengthMm = 4, offsetMm?: number): number {
  const off = offsetMm ?? Math.max(2, bleedMm + 1);
  const base = 2 * bleedMm;
  if (mode === 'corner') return Math.max(base, 2 * (off + lengthMm));
  if (mode === 'grid') return Math.max(base, 0);
  return base;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Cut back, or drop, marks that would reach beyond the edge of the sheet. */
function clip(lines: Line[], sheet: SheetSpec): Line[] {
  const cx = (v: number) => Math.min(sheet.wMm, Math.max(0, v));
  const cy = (v: number) => Math.min(sheet.hMm, Math.max(0, v));
  return lines
    .map((l) => ({ x1: cx(l.x1), y1: cy(l.y1), x2: cx(l.x2), y2: cy(l.y2) }))
    .filter((l) => Math.abs(l.x2 - l.x1) > 0.2 || Math.abs(l.y2 - l.y1) > 0.2);
}

/** Is the source resolution enough for the trim size at the wanted dpi? */
export function dpiCheck(srcPx: number, mm: number, wantDpi: number): { dpi: number; ok: boolean } {
  const dpi = mm > 0 ? (srcPx / (mm / 25.4)) : 0;
  return { dpi: Math.round(dpi), ok: dpi >= wantDpi * 0.9 };
}
