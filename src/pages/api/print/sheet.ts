import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { layout, cutMarks, effectiveGap, type PlaceSpec, type SheetSpec, type MarkMode, type Page, type Line } from '../../../lib/printlayout';
import { fitsOnSheet, overflowPlacement, tilePlan, tileCrop, tileSheet, noteInset, type Oversize } from '../../../lib/printoversize';
import { renderCell, type CropRel, type SheetCellImage, buildSheetPdf, type PageExtras, type FooterPos } from '../../../lib/printrender';
import { loadSource, type PrintSource } from '../../../lib/printsource';
import { buildSheetFilename } from '../../../lib/naming';
import { paperById, parseSizeMm, labelMm } from '../../../lib/paper';
import { cfgForKey } from '../../../lib/delivery';
import { uploadBuffer } from '../../../lib/remotetarget';
import { one } from '../../../lib/db';
import { recordRun, summarise } from '../../../lib/printruns';

export const prerender = false;

const MAX_CELLS = 40;       // different images per sheet
const MAX_COPIES = 200;     // copies per image
const MAX_PAGES = 60;   // poster printing needs more pages than a passport photo sheet
const MAX_PIECES = 500;     // sum of all copies — keeps the packer from degenerating

interface CellIn {
  id: string;
  src: PrintSource;
  crop?: CropRel | null;
  wMm?: number; hMm?: number;
  size?: string;            // free text ("12x15", "35x45mm") as an alternative to wMm/hMm
  count?: number;
  allowRotate?: boolean;
  landscape?: boolean;      // image size landscape instead of portrait
  fit?: 'cover' | 'contain';// differing aspect ratio: crop or letterbox
  bg?: string;              // letterbox colour
  oversize?: Oversize;      // larger than the sheet: report, let it run over, or tile
  overlapMm?: number;       // glue flap when tiling
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  try {
    const sheet = readSheet(body);
    const marksMode: MarkMode = ['none', 'corner', 'grid'].includes(body?.marks?.mode) ? body.marks.mode : 'corner';
    const dpi = clamp(Number(body?.dpi) || 300, 72, 1200);
    const wantExt: 'jpg' | 'png' = body?.ext === 'png' ? 'png' : 'jpg';

    const cellsIn: CellIn[] = Array.isArray(body?.cells) ? body.cells.slice(0, MAX_CELLS) : [];
    if (!cellsIn.length) return json({ error: 'No images given.' }, 400);

    const specs: PlaceSpec[] = [];
    const resolved: { cell: CellIn; wMm: number; hMm: number }[] = [];
    // Cells that do not fit on the sheet and take their own route instead.
    const big: { cell: CellIn; wMm: number; hMm: number; count: number; mode: Oversize }[] = [];

    for (const [i, c] of cellsIn.entries()) {
      const size = cellSize(c);
      if (!size) return json({ error: `Image ${i + 1}: size is missing or invalid.` }, 400);
      const id = String(c.id || `c${i}`);
      const count = clamp(Math.round(Number(c.count) || 1), 1, MAX_COPIES);
      const allowRotate = c.allowRotate !== false;
      const mode: Oversize = c.oversize === 'overflow' || c.oversize === 'tile' ? c.oversize : 'fit';

      if (mode !== 'fit' && !fitsOnSheet(size.w, size.h, sheet, allowRotate)) {
        big.push({ cell: { ...c, id }, wMm: size.w, hMm: size.h, count, mode });
        continue;
      }
      specs.push({ id, wMm: size.w, hMm: size.h, count, allowRotate });
      resolved.push({ cell: { ...c, id }, wMm: size.w, hMm: size.h });
    }
    if (!specs.length && !big.length) return json({ error: 'No images given.' }, 400);

    const totalPieces = specs.reduce((n, s) => n + s.count, 0) + big.reduce((n, b) => n + b.count, 0);
    if (totalPieces > MAX_PIECES) return json({ error: `Too many individual images (${totalPieces}). At most ${MAX_PIECES} per sheet job.` }, 422);

    const plan = specs.length ? layout(specs, sheet) : { pages: [] as Page[], unplaced: [], perSheet: 0 };
    if (!plan.pages.length && !big.length) {
      return json({ error: 'Nothing could be placed — the image size is larger than the usable area of the sheet.', unplaced: plan.unplaced }, 422);
    }

    // Render each image exactly once — even for 24 copies.
    // Rotated placements need their own take.
    // The image key is deliberately NOT derived from the cell id — a cell named
    // "x::rot" would otherwise overwrite the rotated take of "x".
    const keyOf = (id: string, rot: boolean) => `${specs.findIndex((s) => s.id === id)}${rot ? 'r' : 'p'}`;
    const images: Record<string, SheetCellImage> = {};
    const needRotated = new Set<string>();
    const needPlain = new Set<string>();
    for (const pg of plan.pages) for (const p of pg.placements) (p.rotated ? needRotated : needPlain).add(p.specId);

    for (const r of resolved) {
      const buf = await loadSource(r.cell.src, locals.user as any);
      if (needPlain.has(r.cell.id)) {
        const out = await renderCell(buf, r.cell.crop ?? null, r.wMm, r.hMm, dpi,
          { ext: wantExt, bleedMm: sheet.bleedMm, rotate: false, fit: fitOf(r.cell), background: bgOf(r.cell) });
        images[keyOf(r.cell.id, false)] = { bytes: out.buffer, ext: out.ext };
      }
      if (needRotated.has(r.cell.id)) {
        const out = await renderCell(buf, r.cell.crop ?? null, r.wMm, r.hMm, dpi,
          { ext: wantExt, bleedMm: sheet.bleedMm, rotate: true, fit: fitOf(r.cell), background: bgOf(r.cell) });
        images[keyOf(r.cell.id, true)] = { bytes: out.buffer, ext: out.ext };
      }
    }

    // Point the placements at the matching take of the image.
    const pages = plan.pages.map((pg) => ({
      placements: pg.placements.map((p) => ({ ...p, specId: keyOf(p.specId, p.rotated) })),
    }));

    const marks = plan.pages.map((pg) =>
      cutMarks(pg, sheet, {
        mode: marksMode,
        lengthMm: numOr(body?.marks?.lengthMm, 4, 1, 20),
        offsetMm: body?.marks?.offsetMm != null ? numOr(body.marks.offsetMm, 3, 0, 20) : undefined,
        bleedMm: sheet.bleedMm,
      }));
    const extras: PageExtras[] = plan.pages.map(() => ({}));

    // --- Oversize images: let them run over, or tile them across several sheets ---
    const notes: string[] = [];
    for (const [bi, b] of big.entries()) {
      const buf = await loadSource(b.cell.src, locals.user as any);
      const opts = { ext: wantExt, fit: fitOf(b.cell), background: bgOf(b.cell) };

      if (b.mode === 'overflow') {
        const info = overflowPlacement(b.cell.id, 1, b.wMm, b.hMm, sheet, b.cell.allowRotate !== false);
        const key = `o${bi}`;
        const out = await renderCell(buf, b.cell.crop ?? null, b.wMm, b.hMm, dpi, { ...opts, rotate: info.rotated });
        images[key] = { bytes: out.buffer, ext: out.ext };
        for (let c = 0; c < b.count; c++) {
          pages.push({ placements: [{ ...info.placement, specId: key, copy: c + 1 }] });
          marks.push([]);   // marks would be pointless here, the edges lie outside the sheet
          extras.push({});
        }
        if (info.lostMm > 0.05)
          notes.push(`${labelMm(b.wMm, b.hMm)} runs over the sheet: ${fmtMm(info.lostLeft + info.lostRight)} is missing in width and ${fmtMm(info.lostTop + info.lostBottom)} in height.`);
      } else {
        const noteMm = noteInset(sheet);
        const tp = tilePlan(b.wMm, b.hMm, tileSheet(sheet), numOr(b.cell.overlapMm, 10, 0, 40));
        if (tp.tiles.length * b.count > MAX_PAGES)
          return json({ error: `The poster print would need ${tp.tiles.length * b.count} sheets — please choose a smaller size or larger paper.` }, 422);

        const inset = sheet.marginMm || 0;
        for (const [ti, t] of tp.tiles.entries()) {
          const key = `t${bi}_${ti}`;
          const crop = tileCrop(b.cell.crop ?? { x: 0, y: 0, w: 1, h: 1 }, t, b.wMm, b.hMm);
          const out = await renderCell(buf, crop, t.wMm, t.hMm, dpi, { ...opts, rotate: false });
          images[key] = { bytes: out.buffer, ext: out.ext };

          // Make the glue flap visible: dashed where the neighbouring sheet joins.
          const dashed: Line[] = [];
          const top = inset + noteMm;
          if (t.glueRight) { const x = inset + t.wMm - tp.overlapMm; dashed.push({ x1: x, y1: top, x2: x, y2: top + t.hMm }); }
          if (t.glueBottom) { const y = top + t.hMm - tp.overlapMm; dashed.push({ x1: inset, y1: y, x2: inset + t.wMm, y2: y }); }

          for (let c = 0; c < b.count; c++) {
            pages.push({ placements: [{ specId: key, copy: c + 1, x: inset, y: inset + noteMm, w: t.wMm, h: t.hMm, rotated: false }] });
            marks.push([]);
            extras.push({
              note: `Sheet ${ti + 1}/${tp.tiles.length} · row ${t.row + 1}, column ${t.col + 1}` +
                    (tp.overlapMm > 0 ? ` · ${fmtMm(tp.overlapMm)} glue flap (dashed)` : ''),
              dashed,
            });
          }
        }
        notes.push(`${labelMm(b.wMm, b.hMm)} spread over ${tp.cols} × ${tp.rows} sheets, ${fmtMm(tp.overlapMm)} overlap for gluing.`);
      }
    }

    if (pages.length > MAX_PAGES) return json({ error: `Too many sheets (${pages.length}). Please reduce the quantity.` }, 422);

    const kinds = [
      ...resolved.map((r) => `${labelMm(r.wMm, r.hMm)}${specs.find((s) => s.id === r.cell.id)!.count > 1 ? ` ×${specs.find((s) => s.id === r.cell.id)!.count}` : ''}`),
      ...big.map((b) => `${labelMm(b.wMm, b.hMm)}${b.count > 1 ? ` ×${b.count}` : ''}${b.mode === 'tile' ? ' (poster)' : ' (oversize)'}`),
    ];
    const footer = readFooter(body, sheet, kinds, dpi);

    const bytes = await buildSheetPdf({
      sheet, pages, marksPerPage: marks, images, extrasPerPage: extras,
      title: String(body?.title || 'Klarbild print sheet'),
      footer,
      markWidthPt: numOr(body?.marks?.widthPt, 0.25, 0.1, 2),
    });

    // The id of the history entry is created **before** the file name so that both
    // carry the same short id: whoever holds a PDF file can find the matching
    // entry again under "Last printed".
    const runId = randomUUID();
    const filename = buildSheetFilename({
      name: body?.name, paperId: typeof body?.paper === 'string' ? body.paper : body?.paper?.id,
      wMm: sheet.wMm, hMm: sheet.hMm, pieces: totalPieces, pages: pages.length, runId,
    });

    // Optional: also push the finished sheet to the usual target (the default
    // delivery target, the backup mirror or an extra target) — as with the images.
    let delivered = '0', deliveryMsg = '';
    if (body?.deliver) {
      const key = body.deliver.target === '' || body.deliver.target == null ? 'remote' : String(body.deliver.target);
      try {
        // Check the folder name first: no slashes, no "..", otherwise posixpath.join
        // could be used to break out of the target's base folder.
        const wish = String(body.deliver.gallery || '').trim();
        if (wish && (wish.includes('..') || !/^[\p{L}\p{N} _.\-]{1,64}$/u.test(wish)))
          throw new Error('Invalid folder name.');
        const cfg = await cfgForKey(key);
        if (!cfg) throw new Error('Target is not configured.');
        const s = await one<{ delivery_default_folder: string | null }>('SELECT delivery_default_folder FROM settings WHERE id=1');
        const gallery = wish || s?.delivery_default_folder || 'Gallery A';
        await uploadBuffer(cfg, gallery, filename, Buffer.from(bytes));
        delivered = '1';
        deliveryMsg = `Sheet delivered to "${gallery}".`;
      } catch (e: any) {
        deliveryMsg = `Delivery failed: ${e?.message || e}`;
      }
    }

    // Record the print — only the instructions, not the PDF. A failure here must
    // never cost the sheet: it is finished and about to go out.
    try {
      await recordRun({
        id: runId,
        userId: locals.user.uid ?? null,
        origin: String(body?.origin || 'web'),
        summary: summarise(kinds),
        paper: `${labelMm(sheet.wMm, sheet.hMm)}`,
        pages: pages.length,
        pieces: totalPieces,
        bytes: bytes.length,
        config: body,
        itemIds: [...cellsIn, ...big.map((b) => b.cell)]
          .map((c: any) => (c?.src?.kind === 'item' ? String(c.src.id) : null))
          .filter(Boolean) as string[],
      });
    } catch (e: any) {
      console.error('[print] print history not saved:', e?.message || e);
    }

    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Klarbild-Pages': String(pages.length),
        'X-Klarbild-Per-Sheet': String(plan.perSheet),
        'X-Klarbild-Delivered': delivered,
        ...(notes.length ? { 'X-Klarbild-Notes': encodeURIComponent(notes.join(' ')) } : {}),
        ...(deliveryMsg ? { 'X-Klarbild-Delivery-Msg': encodeURIComponent(deliveryMsg) } : {}),
      },
    });
  } catch (e: any) {
    // Internal details (paths, host names of delivery targets) stay in the log.
    console.error('[print/sheet]', e?.message || e);
    return json({ error: userMessage(e) }, 400);
  }
};

/** Only pass on messages we wrote ourselves, nothing from deeper down. */
const SAFE = /^(Paper size|Image \d|Size|Invalid|Unknown|Image not|No access|Source|Crop|Target image|Too many)/;
function userMessage(e: any): string {
  const m = String(e?.message || '');
  return SAFE.test(m) ? m : 'The print sheet could not be created.';
}

function readSheet(body: any): SheetSpec {
  let w: number | null = null, h: number | null = null;
  const p = body?.paper;
  if (typeof p === 'string') { const pp = paperById(p); if (pp) { w = pp.w; h = pp.h; } }
  else if (p && typeof p === 'object') {
    if (p.id) { const pp = paperById(String(p.id)); if (pp) { w = pp.w; h = pp.h; } }
    if (p.wMm && p.hMm) { w = Number(p.wMm); h = Number(p.hMm); }
    if (!w && p.size) { const s = parseSizeMm(String(p.size)); if (s) { w = s.w; h = s.h; } }
  }
  if (!w || !h) throw new Error('Paper size is missing or unknown.');
  if (body?.landscape) [w, h] = [h, w];
  if (w < 20 || h < 20 || w > 2000 || h > 2000) throw new Error('Paper size is outside the allowed range.');

  const bleedMm = numOr(body?.bleedMm, 0, 0, 10);
  const sheet: SheetSpec = {
    wMm: w, hMm: h,
    marginMm: numOr(body?.marginMm, 5, 0, 50),
    gapMm: numOr(body?.gapMm, 4, 0, 100),
    bleedMm,
    center: body?.center !== false,
  };
  sheet.gapMm = effectiveGap(sheet);
  return sheet;
}

function cellSize(c: CellIn): { w: number; h: number } | null {
  let s: { w: number; h: number } | null = null;
  if (Number(c.wMm) > 0 && Number(c.hMm) > 0) s = { w: Number(c.wMm), h: Number(c.hMm) };
  else if (c.size) s = parseSizeMm(String(c.size));
  if (!s || s.w < 5 || s.h < 5 || s.w > 2000 || s.h > 2000) return null;
  return c.landscape ? { w: s.h, h: s.w } : s;
}

/** Millimetres in human-readable form: "3 mm", "1.5 mm", "0 mm". */
const fmtMm = (n: number) => `${Math.round(n * 10) / 10} mm`;

const FOOTER_POS: FooterPos[] = ['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-center', 'top-rechts'];

/** Caption: off, automatic, or your own text at a position you choose. */
function readFooter(body: any, sheet: SheetSpec, kinds: string[], dpi: number) {
  const f = body?.footer;
  if (f === false || f === null) return null;
  const auto = `Klarbild · ${labelMm(sheet.wMm, sheet.hMm)} · ${kinds.join(' · ')} · ${dpi} dpi · print at 100% (not "fit to page")`;
  if (f === true || f == null) return { text: auto, position: 'bottom-left' as FooterPos, sizePt: 6 };
  const text = typeof f.text === 'string' && f.text.trim() ? f.text.trim().slice(0, 200) : auto;
  const position = FOOTER_POS.includes(f.position) ? f.position as FooterPos : 'bottom-left';
  return { text, position, sizePt: numOr(f.sizePt, 6, 4, 14) };
}

const fitOf = (c: CellIn): 'cover' | 'contain' => (c.fit === 'contain' ? 'contain' : 'cover');
/** Only allow a safe hex value as the letterbox colour. */
const bgOf = (c: CellIn): string => (/^#[0-9a-f]{6}$/i.test(String(c.bg || '')) ? String(c.bg) : '#ffffff');

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const numOr = (v: any, def: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : def;
};
