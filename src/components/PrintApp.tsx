import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { PAPERS, PHOTO_SIZES, parseSizeMm, labelMm, mmToPx, paperById, photoById } from '../lib/paper';
import {
  layout, cutMarks, recommendedGap, dpiCheck,
  type SheetSpec, type PlaceSpec, type MarkMode,
} from '../lib/printlayout';
import { fitsOnSheet, overflowPlacement, tilePlan, tileSheet, type Oversize } from '../lib/printoversize';
import { baseCrop, clampCrop, centred, limitsFor, type CropRel, type FitMode } from '../lib/cropmath';
import PrintRuns from './PrintRuns';
import { filenameFromHeader } from '../lib/naming';
import { useT, type Dict, type Locale, type TFunction } from '../lib/useT';

/* --------------------------------------------------------------------------
   Print — bring images to an exact size without AI and put several of them on
   one sheet with crop marks.

   Arrangement: you work on the left and look on the right. On a desktop the
   preview runs alongside the work (sticky), on a phone it sits directly under
   the images and above the settings — it is the only feedback on whether the
   sheet is right.
   -------------------------------------------------------------------------- */

type SrcRef = { kind: 'upload'; path: string } | { kind: 'item'; id: string };
// CropRel and FitMode come from cropmath.ts — one definition for browser and server.

interface Cell {
  id: string;
  name: string;
  preview: string;             // shrunken data URL, or /api/items/…
  src?: SrcRef;
  uploading?: boolean;
  error?: string;
  natW: number; natH: number;
  sizeId: string;
  customSize: string;
  landscape: boolean;
  count: number;
  allowRotate: boolean;
  fit: FitMode;
  bg: string;
  oversize: Oversize;
  overlapMm: number;
  crop: CropRel;
}

/** Key of the local settings store. The spelling stays — a new key would drop everyone's saved setup. */
const STORE = 'klarbild.print.v2';
const MAX_IMAGES = 30;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const safeColor = (v: unknown): string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#ffffff';
/** "1 sheet", "2 sheets", "1 image", "5 images" — the singular is not a detail. */
const count = (n: number, one: string, many: string) => (n === 1 ? one : many).split('{n}').join(String(n));
// Millimetres for display. The decimal comma follows `labelMm` in lib/paper.ts,
// where tests pin the spelling — one caption should not mix "5,5 mm" and "5.5 mm".
const mm = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/* ---------------- Crop maths ----------------------------------------------
   Comes from `src/lib/cropmath.ts` — exactly the file the server uses for the
   PDF. The calculation used to sit here a second time; two copies of the same
   formula drift apart sooner or later, and then the preview shows something
   other than what is printed. */

const sizeOfCell = (c: Cell): { w: number; h: number } | null => {
  const base = c.sizeId === 'custom' ? parseSizeMm(c.customSize) : photoById(c.sizeId);
  if (!base) return null;
  return c.landscape ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
};
const aspectOf = (c: Cell): number => { const s = sizeOfCell(c); return s ? s.w / s.h : 1; };

/**
 * Places the image in the frame so that exactly `c` is visible. The height comes
 * from the real aspect ratio of the image — that way nothing can ever distort.
 */
function cropStyle(c: CropRel, natW?: number, natH?: number): React.CSSProperties {
  return {
    position: 'absolute',
    width: `${100 / c.w}%`,
    ...(natW && natH ? { aspectRatio: `${natW} / ${natH}`, height: 'auto' as const } : { height: `${100 / c.h}%` }),
    left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%`,
  };
}

function newCell(id: string, name: string): Cell {
  return {
    id, name, preview: '', uploading: true, natW: 1000, natH: 1500,
    sizeId: 'S10x15', customSize: '', landscape: false, count: 1, allowRotate: true,
    fit: 'cover', bg: '#ffffff', oversize: 'fit', overlapMm: 10,
    crop: { x: 0, y: 0, w: 1, h: 1 },
  };
}

/** Compute the preview small — 30 phone photos as full data URLs blow the tab apart. */
function shrink(dataUrl: string, maxEdge = 700): Promise<{ url: string; w: number; h: number }> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      if (k >= 1) return res({ url: dataUrl, w: img.naturalWidth, h: img.naturalHeight });
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      res({ url: cv.toDataURL('image/jpeg', 0.72), w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => res({ url: dataUrl, w: 0, h: 0 });
    img.src = dataUrl;
  });
}

/* ========================================================================== */

export default function PrintApp({ locale, dict }: { locale?: Locale; dict?: Dict | null }) {
  const t = useT(dict);
  const [cells, setCells] = useState<Cell[]>([]);
  const [paperId, setPaperId] = useState('A4');
  const [paperCustom, setPaperCustom] = useState('');
  const [paperLandscape, setPaperLandscape] = useState(false);
  const [marginMm, setMarginMm] = useState(5);
  const [autoGap, setAutoGap] = useState(true);
  const [gapMm, setGapMm] = useState(8);
  const [bleedMm, setBleedMm] = useState(0);
  const [marks, setMarks] = useState<MarkMode>('corner');
  const [markLen, setMarkLen] = useState(3);
  const [markOff, setMarkOff] = useState(1);
  const [dpi, setDpi] = useState(300);
  const [ext, setExt] = useState<'jpg' | 'png'>('jpg');
  const [center, setCenter] = useState(true);
  const [footerOn, setFooterOn] = useState(true);
  const [footerText, setFooterText] = useState('');
  const [footerPos, setFooterPos] = useState('bottom-left');
  const [deliverTo, setDeliverTo] = useState('');
  const [gallery, setGallery] = useState('');

  const [targets, setTargets] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  // The history only loads when it is opened — one request less on every page.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [presets, setPresets] = useState<any[]>([]);
  const [presetSel, setPresetSel] = useState('');
  const [busy, setBusy] = useState<null | 'pdf' | 'single'>(null);
  const [toast, setToast] = useState<{ text: string; sticky?: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sheetIdx, setSheetIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const notify = (text: string, sticky = false) => {
    setToast({ text, sticky });
    if (!sticky) setTimeout(() => setToast(null), 3200);
  };

  /* ---------------- Sheet ---------------- */
  const paper = useMemo(() => {
    const p = paperId === 'custom' ? parseSizeMm(paperCustom) : paperById(paperId);
    if (!p) return null;
    return paperLandscape ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
  }, [paperId, paperCustom, paperLandscape]);

  const gapEff = autoGap ? Math.max(recommendedGap(marks, bleedMm, markLen, markOff), 2) : gapMm;
  const sheet: SheetSpec | null = paper
    ? { wMm: paper.w, hMm: paper.h, marginMm, gapMm: gapEff, bleedMm, center }
    : null;
  const usable = sheet
    ? { w: sheet.wMm - 2 * (marginMm + bleedMm), h: sheet.hMm - 2 * (marginMm + bleedMm) }
    : null;

  /** Does the cell fit on the sheet? Also says what the ways out cost. */
  const fitsCell = useCallback((c: Cell) => {
    const s = sizeOfCell(c);
    if (!s || !sheet) return { ok: true } as const;
    if (fitsOnSheet(s.w, s.h, sheet, c.allowRotate)) return { ok: true } as const;
    const of = overflowPlacement(c.id, 1, s.w, s.h, sheet, c.allowRotate);
    const tp = tilePlan(s.w, s.h, tileSheet(sheet), c.overlapMm);
    return { ok: false, size: s, lost: of.lostMm, sheets: tp.tiles.length, cols: tp.cols, rows: tp.rows } as const;
  }, [sheet]);

  const specs: PlaceSpec[] = useMemo(() => cells.flatMap((c) => {
    const s = sizeOfCell(c);
    if (!s || c.error || !c.src) return [];
    if (sheet && !fitsOnSheet(s.w, s.h, sheet, c.allowRotate) && c.oversize !== 'fit') return [];
    return [{ id: c.id, wMm: s.w, hMm: s.h, count: c.count, allowRotate: c.allowRotate }];
  }), [cells, sheet]);

  const plan = useMemo(() => (sheet && specs.length ? layout(specs, sheet) : null), [sheet, specs]);
  const marksPerPage = useMemo(() => (plan && sheet)
    ? plan.pages.map((pg) => cutMarks(pg, sheet, { mode: marks, lengthMm: markLen, offsetMm: markOff, bleedMm }))
    : [], [plan, sheet, marks, markLen, markOff, bleedMm]);

  /** Extra sheets from oversize images — only to show the total. */
  const extraSheets = useMemo(() => cells.reduce((n, c) => {
    const p = fitsCell(c);
    if (p.ok || c.oversize === 'fit') return n;
    return n + (c.oversize === 'tile' ? p.sheets * c.count : c.count);
  }, 0), [cells, fitsCell]);

  const sheetsTotal = (plan?.pages.length || 0) + extraSheets;
  const ready = cells.filter((c) => c.src && !c.error && sizeOfCell(c));
  const imagesTotal = ready.reduce((n, c) => n + c.count, 0);
  const rotated = plan?.pages.some((pg) => pg.placements.some((p) => p.rotated));
  const canPrint = !!(plan?.pages.length || extraSheets);

  useEffect(() => { if (sheetIdx >= Math.max(1, plan?.pages.length || 0)) setSheetIdx(0); }, [plan, sheetIdx]);

  /* ---------------- Local store ---------------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.paperId) setPaperId(s.paperId);
        if (s.paperCustom != null) setPaperCustom(s.paperCustom);
        setPaperLandscape(!!s.paperLandscape);
        if (s.marginMm != null) setMarginMm(s.marginMm);
        setAutoGap(s.autoGap !== false);
        if (s.gapMm != null) setGapMm(s.gapMm);
        if (s.bleedMm != null) setBleedMm(s.bleedMm);
        if (s.marks) setMarks(s.marks);
        if (s.markLen != null) setMarkLen(s.markLen);
        if (s.markOff != null) setMarkOff(s.markOff);
        if (s.dpi) setDpi(s.dpi);
        if (s.ext) setExt(s.ext);
        setCenter(s.center !== false);
        setFooterOn(s.footerOn !== false);
        if (s.footerText != null) setFooterText(s.footerText);
        if (s.footerPos) setFooterPos(s.footerPos);
      }
    } catch { /* never mind */ }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({
          paperId, paperCustom, paperLandscape, marginMm, autoGap, gapMm, bleedMm,
          marks, markLen, markOff, dpi, ext, center, footerOn, footerText, footerPos,
        }));
      } catch { /* storage full — no harm */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [paperId, paperCustom, paperLandscape, marginMm, autoGap, gapMm, bleedMm,
      marks, markLen, markOff, dpi, ext, center, footerOn, footerText, footerPos]);

  /* ---------------- Images ---------------- */
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const all = Array.from(files);
    const images = all.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (all.length > images.length)
      notify(t('{files} skipped — images only (JPG, PNG, WEBP, HEIC).',
        { files: count(all.length - images.length, t('{n} file'), t('{n} files')) }));
    if (images.length > MAX_IMAGES)
      notify(t('Only the first {max} images taken ({n} selected).', { max: MAX_IMAGES, n: images.length }));

    for (const f of images.slice(0, MAX_IMAGES)) {
      const id = uid();
      setCells((p) => [...p, newCell(id, f.name)]);
      const reader = new FileReader();
      reader.onload = async () => {
        const { url, w, h } = await shrink(reader.result as string);
        setCells((p) => p.map((x) => {
          if (x.id !== id) return x;
          // A landscape photo starts out landscape — otherwise "Portrait" cuts off heads and feet.
          const landscape = w > 0 && h > 0 ? w > h : x.landscape;
          const next = { ...x, preview: url, natW: w || x.natW, natH: h || x.natH, landscape };
          next.crop = baseCrop(next.natW, next.natH, aspectOf(next), next.fit);
          return next;
        }));
      };
      reader.readAsDataURL(f);

      const fd = new FormData(); fd.append('files', f);
      try {
        const j = await fetch('/api/uploads', { method: 'POST', body: fd }).then((r) => r.json());
        const info = j.files?.[0];
        setCells((p) => p.map((x) => x.id === id ? {
          ...x, uploading: false, error: info?.error,
          src: info?.source_path ? { kind: 'upload', path: info.source_path } : undefined,
          natW: info?.width || x.natW, natH: info?.height || x.natH,
        } : x));
      } catch {
        setCells((p) => p.map((x) => x.id === id ? { ...x, uploading: false, error: t('Upload failed') } : x));
      }
    }
  }, [t]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editing || picker) return;
      const imgs = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/'));
      if (imgs.length) addFiles(imgs.map((i) => i.getAsFile()!).filter(Boolean));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles, editing, picker]);

  useEffect(() => {
    loadPresets();
    fetch('/api/delivery-targets').then((r) => r.json()).then((j) => setTargets(j.targets || [])).catch(() => {});
  }, []);
  const loadPresets = () => fetch('/api/print/presets').then((r) => r.json())
    .then((j) => setPresets(j.presets || [])).catch(() => {});

  /**
   * Take over the settings of an earlier print — paper, marks, margins,
   * quality. The **images** deliberately stay behind: whoever presses "apply"
   * usually wants the same setup for a different motif. Whoever wants the same
   * sheet takes "Print again".
   */
  const applyConfig = (cfg: any) => {
    if (!cfg) return;
    try {
      if (cfg.paper?.id) setPaperId(cfg.paper.id);
      else if (cfg.paper?.size) { setPaperId('custom'); setPaperCustom(String(cfg.paper.size)); }
      if (typeof cfg.landscape === 'boolean') setPaperLandscape(cfg.landscape);
      if (cfg.marks?.mode) setMarks(cfg.marks.mode);
      if (cfg.marks?.lengthMm != null) setMarkLen(Number(cfg.marks.lengthMm));
      if (cfg.marks?.offsetMm != null) setMarkOff(Number(cfg.marks.offsetMm));
      if (cfg.marginMm != null) setMarginMm(Number(cfg.marginMm));
      if (cfg.bleedMm != null) setBleedMm(Number(cfg.bleedMm));
      if (cfg.gapMm != null) { setAutoGap(false); setGapMm(Number(cfg.gapMm)); }
      if (cfg.dpi != null) setDpi(Number(cfg.dpi));
      if (cfg.ext) setExt(cfg.ext === 'png' ? 'png' : 'jpg');
      if (typeof cfg.center === 'boolean') setCenter(cfg.center);
      notify(t('Settings applied. You pick the images yourself — “Print again” takes those too.'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { notify(t('These settings could not be applied.'), true); }
  };

  const addFromLibrary = (it: any) => {
    const [w, h] = String(it.output_px || '').split(/[x×]/).map((n: string) => parseInt(n, 10) || 0);
    const id = uid();
    const c: Cell = {
      ...newCell(id, it.filename || t('Image')),
      uploading: false,
      src: { kind: 'item', id: it.id },
      preview: `/api/items/${it.id}/file?thumb=1`,
      natW: w || 2000, natH: h || 3000,
      landscape: !!(w && h && w > h),
    };
    c.crop = baseCrop(c.natW, c.natH, aspectOf(c), c.fit);
    setCells((p) => [...p, c]);
  };

  const patch = (id: string, up: Partial<Cell>) => setCells((p) => p.map((c) => {
    if (c.id !== id) return c;
    const next = { ...c, ...up };
    if (up.sizeId !== undefined || up.customSize !== undefined || up.landscape !== undefined || up.fit !== undefined) {
      const a = aspectOf(next);
      if (a) next.crop = baseCrop(next.natW, next.natH, a, next.fit, c.crop);
    }
    return next;
  }));

  /** The same image a second time — for two formats without uploading again. */
  const duplicate = (id: string) => setCells((p) => {
    const i = p.findIndex((c) => c.id === id);
    if (i < 0) return p;
    const copy: Cell = { ...p[i], id: uid() };
    const next = [...p]; next.splice(i + 1, 0, copy);
    return next;
  });

  /* ---------------- Output ---------------- */
  const body = () => ({
    paper: paperId === 'custom' ? { size: paperCustom } : { id: paperId },
    landscape: paperLandscape,
    marginMm, gapMm: gapEff, bleedMm, center, dpi, ext,
    footer: footerOn ? { text: footerText.trim() || undefined, position: footerPos } : false,
    marks: { mode: marks, lengthMm: markLen, offsetMm: markOff },
    ...(deliverTo ? { deliver: { target: deliverTo === 'remote' ? '' : deliverTo, gallery: gallery.trim() || undefined } } : {}),
    cells: ready.map((c) => {
      const s = sizeOfCell(c)!;
      return {
        id: c.id, src: c.src, crop: c.crop, wMm: s.w, hMm: s.h, count: c.count,
        allowRotate: c.allowRotate, fit: c.fit, bg: c.bg,
        oversize: c.oversize, overlapMm: c.overlapMm,
      };
    }),
  });

  const makePdf = async () => {
    if (!canPrint) return;
    setBusy('pdf');
    try {
      const res = await fetch('/api/print/sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()),
      });
      if (!res.ok) { notify((await res.json().catch(() => ({}))).error || t('Failed.'), true); return; }
      const blob = await res.blob();
      // The server sends the name along — it carries a timestamp and the short
      // id of the history entry. Building one here would mean two sheets from
      // the same day get the same name again.
      download(blob, filenameFromHeader(res.headers.get('Content-Disposition'), 'klarbild-print.pdf'));
      const n = Number(res.headers.get('X-Klarbild-Pages') || 0);
      const notes = res.headers.get('X-Klarbild-Notes');
      const delivery = res.headers.get('X-Klarbild-Delivery-Msg');
      notify(t('PDF ready · {sheets}. When printing, choose “Actual size / 100 %”.',
        { sheets: count(n, t('{n} sheet'), t('{n} sheets')) })
        + (notes ? ` ${decodeURIComponent(notes)}` : '')
        + (delivery ? ` ${decodeURIComponent(delivery)}` : ''), !!notes);
    } catch { notify(t('Network error.'), true); } finally { setBusy(null); }
  };

  const makeSingle = async (c: Cell) => {
    const s = sizeOfCell(c); if (!s || !c.src) return;
    setBusy('single');
    try {
      const res = await fetch('/api/print/single', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: c.src, crop: c.crop, wMm: s.w, hMm: s.h, dpi, ext, name: c.name, fit: c.fit, bg: c.bg }),
      });
      if (!res.ok) { notify((await res.json().catch(() => ({}))).error || t('Failed.'), true); return; }
      download(await res.blob(), filenameFromHeader(res.headers.get('Content-Disposition'), `image.${ext}`));
      const real = res.headers.get('X-Klarbild-Real-Dpi');
      notify(res.headers.get('X-Klarbild-Dpi-Ok') === '0'
        ? t('Downloaded — careful: the source only carries about {dpi} dpi.', { dpi: String(real) })
        : t('Downloaded · {px} px at {dpi} dpi.', { px: String(res.headers.get('X-Klarbild-Px')), dpi }),
        res.headers.get('X-Klarbild-Dpi-Ok') === '0');
    } catch { notify(t('Network error.'), true); } finally { setBusy(null); }
  };

  /* ---------------- Presets ---------------- */
  const savePreset = async () => {
    const name = prompt(t('Name of the preset? (e.g. “Nursery set”)'));
    if (!name?.trim()) return;
    const config = {
      paperId, paperCustom, paperLandscape, marginMm, autoGap, gapMm, bleedMm,
      marks, markLen, markOff, dpi, ext, center, footerOn, footerText, footerPos, deliverTo, gallery,
      formats: cells.map((c) => ({ sizeId: c.sizeId, customSize: c.customSize, landscape: c.landscape,
        count: c.count, allowRotate: c.allowRotate, fit: c.fit, bg: c.bg, oversize: c.oversize })),
    };
    await fetch('/api/print/presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), config }),
    });
    notify(t('Preset saved.')); loadPresets();
  };

  const applyPreset = (p: any, ask = true) => {
    const c = p?.config; if (!c) return;
    if (ask && cells.length &&
        !confirm(t('Apply “{name}”? Your current format and sheet settings will be replaced.', { name: p.name }))) {
      setPresetSel(''); return;
    }
    setPaperId(c.paperId ?? 'A4'); setPaperCustom(c.paperCustom ?? ''); setPaperLandscape(!!c.paperLandscape);
    setMarginMm(c.marginMm ?? 5); setAutoGap(c.autoGap !== false); setGapMm(c.gapMm ?? 8);
    setBleedMm(c.bleedMm ?? 0); setMarks(c.marks ?? 'corner'); setMarkLen(c.markLen ?? 3); setMarkOff(c.markOff ?? 1);
    setDpi(c.dpi ?? 300); setExt(c.ext === 'png' ? 'png' : 'jpg'); setCenter(c.center !== false);
    setFooterOn(c.footerOn !== false); setFooterText(c.footerText ?? ''); setFooterPos(c.footerPos ?? 'bottom-left');
    setDeliverTo(c.deliverTo ?? ''); setGallery(c.gallery ?? '');

    if (Array.isArray(c.formats) && c.formats.length) {
      setCells((prev) => {
        if (!prev.length) return prev;
        const apply = (cell: Cell, f: any): Cell => {
          const next: Cell = { ...cell, sizeId: f.sizeId, customSize: f.customSize || '',
            landscape: !!f.landscape, count: f.count || 1, allowRotate: f.allowRotate !== false,
            fit: (f.fit === 'contain' ? 'contain' : 'cover') as FitMode, bg: safeColor(f.bg),
            oversize: (f.oversize === 'overflow' || f.oversize === 'tile') ? f.oversize : 'fit' };
          const a = aspectOf(next); if (a) next.crop = baseCrop(next.natW, next.natH, a, next.fit, cell.crop);
          return next;
        };
        if (prev.length === 1 && c.formats.length > 1)
          return c.formats.map((f: any, i: number) => apply({ ...prev[0], id: i === 0 ? prev[0].id : uid() }, f));
        return prev.map((cell, i) => apply(cell, c.formats[Math.min(i, c.formats.length - 1)]));
      });
    }
    notify(Array.isArray(c.formats) && c.formats.length > 1
      ? t('Preset loaded — the image was taken over for every format.')
      : t('Preset loaded.'));
  };

  const deletePreset = async (id: string) => {
    if (!id || !confirm(t('Delete preset?'))) return;
    const r = await fetch(`/api/print/presets?id=${id}`, { method: 'DELETE' });
    if (!r.ok) notify((await r.json().catch(() => ({}))).error || t('Could not be deleted.'), true);
    setPresetSel(''); loadPresets();
  };

  const editCell = cells.find((c) => c.id === editing) || null;
  const disabledReason = !cells.length ? t('No image chosen yet.')
    : !sheet ? t('Paper size missing.')
    : !ready.length ? t('No image is ready — check the size.')
    : !canPrint ? t('No image fits on the sheet.') : null;

  /* ================================= View ================================= */
  return (
    <div className="print">
      <div className="work">
        {/* ---------- left: images + settings ---------- */}
        <div className="col work-left">
          <Card nr="1" title={t('Images')} actions={
            <>
              <button className="link" onClick={() => setPicker(true)}>{t('From the library')}</button>
              {cells.length > 0 && (
                <button className="link danger"
                  onClick={() => { if (confirm(t('Remove {images}?',
                    { images: count(cells.length, t('{n} image'), t('{n} images')) }))) setCells([]); }}>
                  {t('Remove all')}
                </button>
              )}
            </>
          }>
            <div className="stage">
              {cells.length === 0 ? (
                <>
                  <button type="button" className={`drop ${dragging ? 'drag' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
                    <span className="regmark" />
                    <span className="drop-title">{t('Drag images here, or tap')}</span>
                    <span className="drop-hint"><span className="kbd">⌘V</span>{' '}
                      {t('pastes them too · up to {max} at a time · no AI step, only crop, scale, place',
                        { max: MAX_IMAGES })}</span>
                  </button>
                  {/* The second way belongs here as an equal: most images are
                      already in Klarbild and need not be exported and uploaded
                      again first. */}
                  <div className="or"><span>{t('or')}</span></div>
                  <button type="button" className="drop drop-lib" onClick={() => setPicker(true)}>
                    <span className="drop-title">{t('Pick from the library')}</span>
                    <span className="drop-hint">{t('Everything Klarbild has already made — with search, by folder, and several at once')}</span>
                  </button>
                  {presets.length > 0 && (
                    <div className="quickstart">
                      <span className="mono-label">{t('Or start from a preset')}</span>
                      <div className="quick-row">
                        {presets.slice(0, 4).map((p) => (
                          <button key={p.id} className="pbtn" onClick={() => { setPresetSel(p.id); applyPreset(p, false); }}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                      <div className="hint">{t('Pick a preset, then add an image — done.')}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="cells">
                  {cells.map((c) => (
                    <CellCard key={c.id} cell={c} dpi={dpi} sheet={sheet} fits={fitsCell(c)} t={t}
                      paperLabel={paper ? labelMm(paper.w, paper.h) : ''}
                      onPatch={(u) => patch(c.id, u)}
                      onEdit={() => setEditing(c.id)}
                      onSingle={() => makeSingle(c)}
                      onDuplicate={() => duplicate(c.id)}
                      onRemove={() => setCells((p) => p.filter((x) => x.id !== c.id))} />
                  ))}
                  <div className="cell-add-group">
                    <button className="cell-add" onClick={() => fileRef.current?.click()}>{t('＋ Upload')}</button>
                    <button className="cell-add" onClick={() => setPicker(true)}>{t('＋ From the library')}</button>
                  </div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </div>
          </Card>

          <Card nr="2" title={t('Sheet &amp; cut')}>
            <div className="controls">
              <Field label={t('Presets')}>
                <div className="row">
                  <select className="select" value={presetSel} aria-label={t('Choose a preset')}
                    onChange={(e) => { setPresetSel(e.target.value); applyPreset(presets.find((p) => p.id === e.target.value)); }}>
                    <option value="">{t('Choose a preset …')}</option>
                    {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className="pbtn" onClick={savePreset} title={t('Save the current settings as a preset')}>{t('＋ save')}</button>
                  {presetSel && <button className="pbtn" onClick={() => deletePreset(presetSel)} aria-label={t('Delete preset')}>✕</button>}
                </div>
              </Field>

              <Field label={t('Paper')}>
                <select className="select" value={paperId} onChange={(e) => setPaperId(e.target.value)} aria-label={t('Paper size')}>
                  {groupBy(PAPERS).map(([g, list]) => (
                    <optgroup key={g} label={g}>
                      {list.map((p) => <option key={p.id} value={p.id}>{p.label} · {mm(p.w)} × {mm(p.h)} mm</option>)}
                    </optgroup>
                  ))}
                  <option value="custom">{t('Custom paper size …')}</option>
                </select>
                {paperId === 'custom' && (
                  <>
                    <input className="input" value={paperCustom} onChange={(e) => setPaperCustom(e.target.value)}
                      placeholder={t('e.g. 32.9x48.3 (cm) or 329x483mm')} aria-label={t('Custom paper size')} />
                    {paperCustom && !paper && <div className="hint warn">{t('Size not recognised. Examples: “21x29.7”, “329x483mm”.')}</div>}
                  </>
                )}
                <div className="toggle">
                  <button className={!paperLandscape ? 'on' : ''} onClick={() => setPaperLandscape(false)}>{t('Portrait')}</button>
                  <button className={paperLandscape ? 'on' : ''} onClick={() => setPaperLandscape(true)}>{t('Landscape')}</button>
                </div>
                {paper && usable && (
                  <div className="hint">{t('Sheet {sheet} · usable {usable} — the PDF page is exactly the sheet size.',
                    { sheet: labelMm(paper.w, paper.h), usable: labelMm(usable.w, usable.h) })}</div>
                )}
              </Field>

              <div className="groups">
                <Group title={t('Cutting aids')}
                  hint={marks === 'none' ? t('none') : marks === 'corner' ? t('corner marks') : t('continuous')}>
                  <div className="toggle">
                    <button className={marks === 'none' ? 'on' : ''} onClick={() => setMarks('none')}>{t('None')}</button>
                    <button className={marks === 'corner' ? 'on' : ''} onClick={() => setMarks('corner')}>{t('Corner marks')}</button>
                    <button className={marks === 'grid' ? 'on' : ''} onClick={() => setMarks('grid')}>{t('Continuous')}</button>
                  </div>
                  <div className="hint">
                    {marks === 'corner' ? t('Fine marks outside every image — you cut along between the marks.')
                      : marks === 'grid' ? t('Continuous lines across the whole sheet — for the cutting ruler.')
                      : t('No lines — set the edges yourself.')}
                  </div>
                  {marks === 'corner' && (
                    <>
                      <div className="row two">
                        <Mini label={t('Length (mm)')}>
                          <input className="input" type="number" min={1} max={20} step={0.5} value={markLen}
                            onChange={(e) => setMarkLen(Number(e.target.value))} />
                        </Mini>
                        <Mini label={t('Offset (mm)')}>
                          <input className="input" type="number" min={0} max={20} step={0.5} value={markOff}
                            onChange={(e) => setMarkOff(Number(e.target.value))} />
                        </Mini>
                      </div>
                      {marginMm < markOff + markLen && (
                        <div className="hint warn">{t('With a {margin} mm margin there is no room outside for the marks — they get cut off. Set the margin to at least {min} mm.',
                          { margin: mm(marginMm), min: mm(Math.ceil(markOff + markLen)) })}</div>
                      )}
                    </>
                  )}
                  {marks === 'grid' && new Set(ready.map((c) => { const s = sizeOfCell(c); return s ? `${s.w}x${s.h}` : ''; })).size > 1 && (
                    <div className="hint warn" dangerouslySetInnerHTML={{ __html:
                      t('Continuous lines only suit <b>one</b> image size. With mixed sizes they break up — corner marks are better.') }} />
                  )}
                </Group>

                <Group closed title={t('Margins &amp; gaps')} hint={t('Margin {margin} mm', { margin: mm(marginMm) })}>
                  <div className="toggle soft">
                    <button className={marginMm === 0 ? 'on' : ''} onClick={() => setMarginMm(0)}>{t('Borderless')}</button>
                    <button className={marginMm === 5 ? 'on' : ''} onClick={() => setMarginMm(5)}>5 mm</button>
                    <button className={marginMm === 10 ? 'on' : ''} onClick={() => setMarginMm(10)}>10 mm</button>
                  </div>
                  <div className="row two">
                    <Mini label={t('Margin to the paper edge (mm)')}>
                      <input className="input" type="number" min={0} max={40} step={0.5} value={marginMm}
                        onChange={(e) => setMarginMm(Number(e.target.value))} />
                    </Mini>
                    <Mini label={t('Bleed (mm)')}>
                      <input className="input" type="number" min={0} max={10} step={0.5} value={bleedMm}
                        onChange={(e) => setBleedMm(Number(e.target.value))} />
                    </Mini>
                  </div>
                  <div className="hint">{t('The margin is the zone your printer cannot print on — borderless: 0, otherwise 3–5 mm. The bleed is an extra edge printed beyond the trim size and then cut away; at home usually 0.')}</div>
                  <Check checked={autoGap} onChange={setAutoGap}>
                    {t('Gap automatic ({gap} mm — to suit the marks)', { gap: mm(gapEff) })}
                  </Check>
                  {!autoGap && (
                    <input className="input" type="number" min={0} max={60} step={0.5} value={gapMm}
                      onChange={(e) => setGapMm(Number(e.target.value))} aria-label={t('Gap between the images in mm')} />
                  )}
                  <Check checked={center} onChange={setCenter}>{t('Centre on the sheet')}</Check>
                </Group>

                <Group closed title={t('Quality')} hint={`${dpi} dpi · ${ext.toUpperCase()}`}>
                  <div className="row two">
                    <Mini label={t('Resolution (dpi)')}>
                      <select className="select" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                        <option value={150}>{t('150 — draft')}</option>
                        <option value={300}>{t('300 — photo print (standard)')}</option>
                        <option value={600}>{t('600 — very fine')}</option>
                      </select>
                    </Mini>
                    <Mini label={t('Image data in the PDF')}>
                      <select className="select" value={ext} onChange={(e) => setExt(e.target.value as any)}>
                        <option value="jpg">{t('JPG — smaller file')}</option>
                        <option value="png">{t('PNG — lossless')}</option>
                      </select>
                    </Mini>
                  </div>
                </Group>

                <Group closed title={t('Caption')}
                  hint={footerOn ? (footerText.trim() ? t('own text') : t('automatic')) : t('off')}>
                  <Check checked={footerOn} onChange={setFooterOn}>{t('Small line with sizes and a print note')}</Check>
                  {footerOn && (
                    <>
                      <input className="input" value={footerText} onChange={(e) => setFooterText(e.target.value)}
                        placeholder={t('Your own text (empty = sizes, dpi and print note)')} aria-label={t('Caption text')} />
                      <Mini label={t('Place on the sheet')}>
                        <select className="select" value={footerPos} onChange={(e) => setFooterPos(e.target.value)}>
                          <option value="bottom-left">{t('bottom left')}</option>
                          <option value="bottom-center">{t('bottom centre')}</option>
                          <option value="bottom-right">{t('bottom right')}</option>
                          <option value="top-left">{t('top left')}</option>
                          <option value="top-center">{t('top centre')}</option>
                          <option value="top-right">{t('top right')}</option>
                        </select>
                      </Mini>
                      <div className="hint">{t('The line is dropped automatically when there is no room at the chosen edge — it is never printed over an image.')}</div>
                    </>
                  )}
                </Group>

                <Group closed title={t('Where to?')} hint={deliverTo ? t('deliver as well') : t('download only')}>
                  <select className="select" value={deliverTo} onChange={(e) => setDeliverTo(e.target.value)}
                    aria-label={t('Additional target')}>
                    <option value="">{t('Download only')}</option>
                    <option value="remote">{t('Also to the delivery target')}</option>
                    <option value="mirror">{t('Also to the backup mirror')}</option>
                    {targets.map((tg) => <option key={tg.id} value={tg.id}>{t('Also to “{name}”', { name: tg.name })}</option>)}
                  </select>
                  {deliverTo && (
                    <input className="input" style={{ marginTop: 7 }} value={gallery} onChange={(e) => setGallery(e.target.value)}
                      placeholder={t('Folder on the target (empty = default)')} aria-label={t('Folder on the target')} />
                  )}
                </Group>
              </div>
            </div>
          </Card>
        </div>

        {/* ---------- right: preview (runs along on a desktop) ---------- */}
        <div className="col work-right">
          <Card nr="3" title={t('Preview')} actions={
            canPrint ? <span className="hint nopad">{count(sheetsTotal, t('{n} sheet'), t('{n} sheets'))} · {count(imagesTotal, t('{n} image'), t('{n} images'))}</span> : null
          }>
            <div className="preview">
              {!sheet ? <p className="empty">{t('Please give a valid paper size.')}</p>
                : !cells.length ? <p className="empty">{t('Nothing to show yet — add an image on the left.')}</p>
                : !plan?.pages.length ? (
                  <NothingFits cells={cells} usable={usable} paperId={paperId} t={t}
                    extraSheets={extraSheets} onPaper={setPaperId} />
                ) : (
                  <>
                    {plan.pages.length > 1 && (
                      <div className="sheet-nav" role="group" aria-label={t('Choose sheet')}>
                        <button className="pbtn" onClick={() => setSheetIdx((b) => Math.max(0, b - 1))}
                          disabled={sheetIdx === 0} aria-label={t('Previous sheet')}>‹</button>
                        <span className="sheet-no">{t('Sheet {n} / {total}', { n: sheetIdx + 1, total: plan.pages.length })}</span>
                        <button className="pbtn" onClick={() => setSheetIdx((b) => Math.min(plan.pages.length - 1, b + 1))}
                          disabled={sheetIdx >= plan.pages.length - 1} aria-label={t('Next sheet')}>›</button>
                      </div>
                    )}
                    <SheetPreview sheet={sheet} page={plan.pages[Math.min(sheetIdx, plan.pages.length - 1)]}
                      marks={marksPerPage[Math.min(sheetIdx, plan.pages.length - 1)] || []} cells={cells} />
                    <div className="sheet-foot">
                      {t('{images} on this sheet', { images: count(plan.pages[Math.min(sheetIdx, plan.pages.length - 1)].placements.length, t('{n} image'), t('{n} images')) })}
                      {extraSheets > 0 && ` · ${t('plus {sheets} for oversize images', { sheets: count(extraSheets, t('{n} extra sheet'), t('{n} extra sheets')) })}`}
                    </div>
                    {rotated && (
                      <p className="hint">{t('Some images lie sideways so that more fit on the sheet — once cut they stand the right way up. Switch it off with “Rotate to save space”.')}</p>
                    )}
                  </>
                )}
              {plan?.unplaced?.length ? (
                <p className="alert" role="alert">{t('Could not be placed: {list}', { list: plan.unplaced.map((u) => {
                  const c = cells.find((x) => x.id === u.specId);
                  return `${c?.name || u.specId} (${u.reason})`;
                }).join(', ') })}</p>
              ) : null}
            </div>
          </Card>

          <div className="finish">
            <button className="primary" disabled={!canPrint || busy === 'pdf'} onClick={makePdf}>
              {busy === 'pdf' ? <><span className="spin" />{t('Building the PDF …')}</> : t('Make the print PDF')}
            </button>
            <div className="hint center">
              {disabledReason
                ? disabledReason
                : <span dangerouslySetInnerHTML={{ __html:
                    t('In the print dialog choose <b>“Actual size” / 100 %</b> — not “fit to page”.') }} />}
            </div>
          </div>

          {/* Printed last — folded away, because it does not get in the way
              while working but is at hand when the same sheet is needed again. */}
          <Card nr="4" title={t('Printed last')}>
            <div className="stage">
              <details className="history" onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}>
                <summary>
                  <span>{t('Show the list')}</span>
                  <em>{t('make the same sheet once more')}</em>
                </summary>
                <div className="history-body">
                  {historyOpen && <PrintRuns onLoad={applyConfig} locale={locale} dict={dict} />}
                </div>
              </details>
            </div>
          </Card>
        </div>
      </div>

      {editCell && <CropModal cell={editCell} t={t} onClose={() => setEditing(null)}
        onChange={(crop) => patch(editCell.id, { crop })} />}
      {picker && (
        <LibraryPicker t={t} onClose={() => setPicker(false)}
          onPick={(picked) => { picked.forEach(addFromLibrary); setPicker(false); }} />
      )}
      {toast && (
        <div className={`toast ${toast.sticky ? 'sticky' : ''}`} role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.sticky && <button onClick={() => setToast(null)} aria-label={t('Close message')}>✕</button>}
        </div>
      )}
      <PrintStyles />
    </div>
  );
}

/* ---------------- small building blocks ---------------- */

function Card({ nr, title, actions, children }:
  { nr: string; title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        <h2 className="mono-label" id={id}><span className="card-no">{nr} · </span><span dangerouslySetInnerHTML={{ __html: title }} /></h2>
        {actions && <div className="head-tools">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="field"><label>{label}</label>{children}</div>
);

const Mini = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="mini">{label}{children}</label>
);

const Check = ({ checked, onChange, children }:
  { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) => (
  <label className="check">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{children}</span>
  </label>
);

/** A settings group — folded away on a phone, open on a desktop. */
function Group({ title, hint, closed, children }:
  { title: string; hint?: string; closed?: boolean; children: React.ReactNode }) {
  return (
    <details className="group" open={!closed}>
      <summary><span className="mono-label" dangerouslySetInnerHTML={{ __html: title }} />{hint && <em>{hint}</em>}</summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

function groupBy<T extends { group: string }>(list: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of list) { if (!m.has(x.group)) m.set(x.group, []); m.get(x.group)!.push(x); }
  return [...m.entries()];
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------------- Sheet preview ---------------- */

function SheetPreview({ sheet, page, marks, cells }:
  { sheet: SheetSpec; page: { placements: any[] }; marks: any[]; cells: Cell[] }) {
  return (
    <div className="sheet-holder">
      <div className="sheet" style={{ aspectRatio: `${sheet.wMm} / ${sheet.hMm}` }}>
        {page.placements.map((p, k) => {
          const c = cells.find((x) => x.id === p.specId);
          if (!c) return null;
          return (
            <div key={k} className="slot" style={{
              left: `${(p.x / sheet.wMm) * 100}%`, top: `${(p.y / sheet.hMm) * 100}%`,
              width: `${(p.w / sheet.wMm) * 100}%`, height: `${(p.h / sheet.hMm) * 100}%`,
              background: c.fit === 'contain' ? c.bg : undefined,
            }}>
              <div className="rotor" style={p.rotated ? {
                width: `${(p.h / p.w) * 100}%`, height: `${(p.w / p.h) * 100}%`,
                transform: 'translate(-50%, -50%) rotate(90deg)',
              } : undefined}>
                <img src={c.preview} alt="" style={cropStyle(c.crop, c.natW, c.natH)} />
              </div>
              {p.w >= 28 && p.h >= 18 && <span className="slot-size">{labelMm(p.w, p.h)}</span>}
            </div>
          );
        })}
        <svg className="marks" viewBox={`0 0 ${sheet.wMm} ${sheet.hMm}`} preserveAspectRatio="none" aria-hidden="true">
          {marks.map((l, k) => (
            <line key={k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke="#16150F" strokeWidth={0.25} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
    </div>
  );
}

/** When nothing fits: name the reason in centimetres and offer a way out. */
function NothingFits({ cells, usable, paperId, extraSheets, onPaper, t }: {
  cells: Cell[]; usable: { w: number; h: number } | null; paperId: string;
  extraSheets: number; onPaper: (id: string) => void; t: TFunction;
}) {
  if (extraSheets > 0) return (
    <p className="empty">{t('All images are oversize and get sheets of their own — {sheets}. You can still make the PDF.',
      { sheets: count(extraSheets, t('{n} sheet'), t('{n} sheets')) })}</p>
  );
  const tooBig = cells.map((c) => ({ c, s: sizeOfCell(c) })).filter((x) => x.s);
  if (!tooBig.length) return <p className="empty">{t('No valid image size chosen yet.')}</p>;

  const bigger = PAPERS.filter((p) => usable && p.w * p.h > (usable.w + 10) * (usable.h + 10))
    .sort((a, b) => a.w * a.h - b.w * b.h)[0];
  return (
    <div className="deadend" role="alert">
      <p><b>{t('Does not fit on the sheet.')}</b>{' '}
        {t('{sizes} on a usable {usable}.', {
          sizes: tooBig.map((x) => labelMm(x.s!.w, x.s!.h)).join(', '),
          usable: usable ? labelMm(usable.w, usable.h) : '—',
        })}</p>
      <p className="hint">{t('Three ways out: bigger paper, a smaller image size — or pick “Let it overhang” or “Across several sheets” on the image to the left.')}</p>
      {bigger && paperId !== bigger.id && (
        <button className="pbtn" onClick={() => onPaper(bigger.id)}>{t('Switch paper to {paper}', { paper: bigger.label })}</button>
      )}
    </div>
  );
}

/* ---------------- Image card ---------------- */

function CellCard({ cell, dpi, sheet, fits, paperLabel, t, onPatch, onEdit, onSingle, onDuplicate, onRemove }: {
  cell: Cell; dpi: number; sheet: SheetSpec | null; paperLabel: string; t: TFunction;
  fits: { ok: boolean; size?: { w: number; h: number }; lost?: number; sheets?: number; cols?: number; rows?: number };
  onPatch: (u: Partial<Cell>) => void; onEdit: () => void; onSingle: () => void;
  onDuplicate: () => void; onRemove: () => void;
}) {
  const s = sizeOfCell(cell);
  const sourcePx = s ? cell.crop.w * cell.natW : 0;
  const realDpi = s && s.w > 0 ? Math.round(sourcePx / (s.w / 25.4)) : 0;
  const level = !s ? null : realDpi >= dpi * 0.9 ? 'ok' : realDpi >= dpi * 0.6 ? 'tight' : 'bad';
  const editable = !cell.uploading && !cell.error;

  return (
    <div className={`cell ${cell.error ? 'err' : ''}`}>
      <button className="cell-x" onClick={onRemove} aria-label={t('Remove {name}', { name: cell.name })}>✕</button>
      <button type="button" className="cell-image" disabled={!editable}
        style={{ aspectRatio: s ? `${s.w} / ${s.h}` : '3 / 4',
                 ...(cell.fit === 'contain' ? { background: cell.bg } : {}) }}
        aria-label={t('Edit the crop of {name}', { name: cell.name })}
        onClick={() => editable && onEdit()}>
        {cell.preview
          ? <img src={cell.preview} alt="" style={cropStyle(cell.crop, cell.natW, cell.natH)} />
          : <span className="loading" />}
        {editable && <span className="cell-zoom">{t('Crop')}</span>}
      </button>

      <div className="cell-controls">
        <select className="select mini-select" value={cell.sizeId} aria-label={t('Format of {name}', { name: cell.name })}
          onChange={(e) => onPatch({ sizeId: e.target.value })}>
          {groupBy(PHOTO_SIZES).map(([g, list]) => (
            <optgroup key={g} label={g}>
              {list.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
          ))}
          <option value="custom">{t('Custom size …')}</option>
        </select>
        {cell.sizeId === 'custom' && (
          <>
            <input className="input mini-input" value={cell.customSize} aria-label={t('Custom size')}
              onChange={(e) => onPatch({ customSize: e.target.value })} placeholder="13x18 · 35x45mm · 4:3/15" />
            {!s && <div className="hint warn">{t('Size not recognised. Examples: “13x18” (cm), “35x45mm”, “4:3/15”.')}</div>}
          </>
        )}

        <div className="cell-row">
          <div className="toggle tiny">
            <button className={!cell.landscape ? 'on' : ''} onClick={() => onPatch({ landscape: false })}>{t('Portrait')}</button>
            <button className={cell.landscape ? 'on' : ''} onClick={() => onPatch({ landscape: true })}>{t('Landscape')}</button>
          </div>
          <div className="count">
            <button onClick={() => onPatch({ count: Math.max(1, cell.count - 1) })} aria-label={t('One fewer')}>−</button>
            <input type="number" min={1} max={200} value={cell.count} aria-label={t('Number of {name}', { name: cell.name })}
              onChange={(e) => onPatch({ count: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })} />
            <button onClick={() => onPatch({ count: Math.min(200, cell.count + 1) })} aria-label={t('One more')}>+</button>
          </div>
        </div>

        <div className="toggle tiny full">
          <button className={cell.fit === 'cover' ? 'on' : ''} onClick={() => onPatch({ fit: 'cover' })}
            title={t('The image fills the format; what hangs over the edges is cut off')}>{t('Crop')}</button>
          <button className={cell.fit === 'contain' ? 'on' : ''} onClick={() => onPatch({ fit: 'contain' })}
            title={t('The whole image stays visible, with a border around it')}>{t('Letterbox')}</button>
        </div>
        {cell.fit === 'contain' && (
          <div className="edge-color">
            <span>{t('Border colour')}</span>
            {['#ffffff', '#000000', '#EAEAE3'].map((col) => (
              <button key={col} className={`swatch ${cell.bg.toLowerCase() === col ? 'on' : ''}`}
                style={{ background: col }} onClick={() => onPatch({ bg: col })} aria-label={t('Border colour {color}', { color: col })} />
            ))}
            <input type="color" value={cell.bg} onChange={(e) => onPatch({ bg: e.target.value })} aria-label={t('Own border colour')} />
          </div>
        )}

        <label className="check tiny">
          <input type="checkbox" checked={cell.allowRotate} onChange={(e) => onPatch({ allowRotate: e.target.checked })} />
          <span>{t('Rotate to save space')}</span>
        </label>

        {/* Oversize: offer the way out right at the problem */}
        {!fits.ok && s && (
          <div className="oversize">
            <b>{t('{size} does not fit on {paper}.', { size: labelMm(s.w, s.h), paper: paperLabel })}</b>
            <div className="toggle tiny full">
              <button className={cell.oversize === 'overflow' ? 'on' : ''} onClick={() => onPatch({ oversize: 'overflow' })}>
                {fits.lost ? t('Overhang (−{mm} mm)', { mm: mm(fits.lost) }) : t('Overhang')}
              </button>
              <button className={cell.oversize === 'tile' ? 'on' : ''} onClick={() => onPatch({ oversize: 'tile' })}>
                {t('{cols} × {rows} sheets', { cols: String(fits.cols), rows: String(fits.rows) })}
              </button>
            </div>
            <div className="hint">
              {cell.oversize === 'overflow'
                ? t('The image lies centred on the sheet; {mm} mm hang over the edge and are missing afterwards.', { mm: mm(fits.lost || 0) })
                : cell.oversize === 'tile'
                ? t('A poster out of {sheets} sheets with a {mm} mm glue flap — the dashed line shows where they overlap.',
                    { sheets: String(fits.sheets), mm: mm(cell.overlapMm) })
                : t('Choose a way, otherwise the image is left out.')}
            </div>
            {cell.oversize === 'tile' && (
              <Mini label={t('Glue flap (mm)')}>
                <input className="input mini-input" type="number" min={0} max={40} step={1} value={cell.overlapMm}
                  onChange={(e) => onPatch({ overlapMm: Math.min(40, Math.max(0, Number(e.target.value) || 0)) })} />
              </Mini>
            )}
          </div>
        )}

        {cell.error ? (
          <>
            <div className="hint warn">{cell.error}</div>
            <button className="pbtn wide" onClick={onRemove}>{t('Remove')}</button>
          </>
        ) : s && (
          <div className={`hint ${level === 'bad' ? 'warn' : level === 'tight' ? 'caution' : ''}`}>
            {t('{size} = {w} × {h} px', { size: labelMm(s.w, s.h), w: mmToPx(s.w, dpi), h: mmToPx(s.h, dpi) })}
            {level === 'ok' ? ` · ${t('resolution is enough')}`
              : level === 'tight' ? ` · ${t('only {dpi} dpi — goes slightly soft', { dpi: realDpi })}`
              : ` · ${t('only {dpi} dpi — goes visibly blurred, take a smaller format or a bigger image', { dpi: realDpi })}`}
          </div>
        )}

        <div className="cell-foot">
          <button className="pbtn" onClick={onDuplicate} title={t('The same image once more — for a second format, say')}>
            {t('Duplicate')}
          </button>
          <button className="pbtn" disabled={!cell.src} onClick={onSingle}>{t('Download on its own')}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Crop ---------------- */

function CropModal({ cell, t, onChange, onClose }:
  { cell: Cell; t: TFunction; onChange: (c: CropRel) => void; onClose: () => void }) {
  const s = sizeOfCell(cell);
  const aspect = s ? s.w / s.h : 1;
  const base = baseCrop(cell.natW, cell.natH, aspect, cell.fit);
  // The same limits as for the initial crop — otherwise the frame would jump to
  // a different value at zoom level 1 than it had when opened.
  const limits = limitsFor(base);
  const [crop, setCrop] = useState<CropRel>(cell.crop);
  const boxRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; crop: CropRel } | null>(null);
  const titleId = useId();

  const zoom = Math.min(6, Math.max(1, base.w / crop.w));
  const setZoom = (z: number) => {
    const zz = Math.min(6, Math.max(1, z));
    setCrop(clampCrop(centred(base.w / zz, base.h / zz, crop), cell.fit, limits));
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.x) / r.width;
    const dy = (e.clientY - drag.current.y) / r.height;
    const c = drag.current.crop;
    setCrop(clampCrop({ ...c, x: c.x - dx * c.w, y: c.y - dy * c.h }, cell.fit, limits));
  };
  const onUp = () => { drag.current = null; };

  const freeX = crop.w < 1 - 1e-4 || cell.fit === 'contain';
  const freeY = crop.h < 1 - 1e-4 || cell.fit === 'contain';
  const direction = freeX && freeY ? t('can be moved in every direction')
    : freeX ? t('can be moved left and right — zoom in first for up and down')
    : freeY ? t('can be moved up and down — zoom in first for left and right')
    : t('an exact fit — zoom in first to move it');

  // Apply rather than discard: the crop is lossless and can be corrected at any time.
  const close = () => { onChange(crop); onClose(); };

  // Catch the focus, hold the background still, keys only in here.
  useEffect(() => {
    const y = window.scrollY;
    const before = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    modalRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => { document.body.style.overflow = ''; window.scrollTo(0, y); before?.focus?.(); };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); return close(); }
    if (e.key === 'Tab') {
      const f = modalRef.current?.querySelectorAll<HTMLElement>('button, input, [href], select, textarea');
      if (!f?.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      setCrop((c) => clampCrop({ ...c, x: c.x + dx * c.w, y: c.y + dy * c.h }, cell.fit, limits));
    };
    if (e.key === 'ArrowLeft') move(-step, 0);
    else if (e.key === 'ArrowRight') move(step, 0);
    else if (e.key === 'ArrowUp') move(0, -step);
    else if (e.key === 'ArrowDown') move(0, step);
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoom * 1.15); }
    else if (e.key === '-') { e.preventDefault(); setZoom(zoom / 1.15); }
  };

  return (
    <div className="modal" onClick={close}>
      <div className="modal-body" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="card-head">
          <h2 className="mono-label" id={titleId}>{t('Crop · {size}', { size: s ? labelMm(s.w, s.h) : '' })}</h2>
          <button className="link" onClick={close}>{t('Done')}</button>
        </div>
        <div className="crop-stage">
          <div ref={boxRef} className="crop-box"
            style={{ ['--ar' as any]: aspect, background: cell.fit === 'contain' ? cell.bg : '#fff' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onDoubleClick={() => setZoom(zoom >= 2.5 ? 1 : zoom * 1.8)}
            onWheel={(e) => setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
            <img src={cell.preview} alt="" draggable={false} style={cropStyle(crop, cell.natW, cell.natH)} />
            <div className="crop-grid" />
          </div>
        </div>
        <div className="crop-controls">
          <label className="mini wide">{t('Zoom · {n}×', { n: zoom.toFixed(1) })}
            <input type="range" min={1} max={6} step={0.01} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <div className={`pan ${freeX || freeY ? '' : 'fixed'}`}>
            <span className="pan-arrows" aria-hidden="true">{freeX && freeY ? '✥' : freeX ? '↔' : freeY ? '↕' : '⊙'}</span>
            {direction}
          </div>
          <div className="row">
            <button className="pbtn" onClick={() => setCrop(base)}>{cell.fit === 'contain' ? t('Whole image') : t('Fill the image')}</button>
            <button className="pbtn" onClick={() => setCrop(clampCrop({ ...crop, x: (1 - crop.w) / 2, y: (1 - crop.h) / 2 }, cell.fit, limits))}>{t('Centre')}</button>
            <button className="primary narrow" onClick={close}>{t('Apply')}</button>
          </div>
          <div className="hint">{t('Grab the image and drag · double-tap zooms · arrow keys for fine work.')}
            {cell.fit === 'contain' && ' ' + t('When fitting in, the border colour stays around the outside.')}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Library ---------------- */

/**
 * Fetch images from the library.
 *
 * The first draft was a line of text in the card head and an unfiltered wall of
 * thumbnails — unusable at a few hundred images, and hardly findable. Now:
 * search, folders, multiple selection. The search runs in the browser over the
 * loaded list; at 400 entries that is there at once and saves a round trip per
 * keystroke.
 */
function LibraryPicker({ onPick, onClose, t }:
  { onPick: (items: any[]) => void; onClose: () => void; t: TFunction }) {
  const [items, setItems] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [inFolder, setInFolder] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const load = useCallback(() => {
    setLoading(true); setFailed(false);
    Promise.all([
      fetch('/api/items').then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch('/api/folders').then((r) => (r.ok ? r.json() : { folders: [] })).catch(() => ({ folders: [] })),
    ])
      .then(([i, f]) => { setItems(i.items || []); setFolders(f.folders || []); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  // Hold the background still, catch the focus, Escape closes.
  useEffect(() => {
    const y = window.scrollY;
    const before = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    box.current?.querySelector<HTMLElement>('input')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = ''; window.scrollTo(0, y); before?.focus?.();
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) =>
      (!inFolder || it.folder_id === inFolder)
      && (!q || String(it.filename || '').toLowerCase().includes(q)
             || String(it.prompt_used || '').toLowerCase().includes(q)));
  }, [items, search, inFolder]);

  const toggle = (id: string) =>
    setPicked((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));

  const accept = () => {
    const pickedItems = picked
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean);
    if (pickedItems.length) onPick(pickedItems);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body wide lib" ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 className="mono-label" id={titleId}>{t('Pick from the library')}</h2>
          <button className="link" onClick={onClose}>{t('Close')}</button>
        </div>

        <div className="lib-filter">
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Search by name or description …')} aria-label={t('Search the library')} />
          {folders.length > 0 && (
            <select className="select" value={inFolder} onChange={(e) => setInFolder(e.target.value)}
              aria-label={t('Folder')}>
              <option value="">{t('All folders')}</option>
              {folders.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        <div className="picker">
          {loading ? <p className="empty">{t('Loading …')}</p>
            : failed ? (
              <p className="empty">{t('The library could not be loaded.')}{' '}
                <button className="pbtn" onClick={load}>{t('Once more')}</button></p>
            )
            : !items.length ? <p className="empty">{t('No images in the library yet.')}</p>
            : !filtered.length ? <p className="empty">{t('Nothing found. Try another search or folder.')}</p>
            : filtered.map((it) => {
              const on = picked.includes(it.id);
              return (
                <button key={it.id} type="button" className={`pick ${on ? 'on' : ''}`}
                  aria-pressed={on} onClick={() => toggle(it.id)} title={it.filename}>
                  <span className="pick-image">
                    {/* If the file is missing from disk the browser would otherwise
                        show a broken-image icon. A quiet area is nicer — and the
                        tile stays clickable, so the print then fails cleanly with
                        a message instead of with an empty box. */}
                    <img src={`/api/items/${it.id}/file?thumb=1`} alt="" loading="lazy"
                         onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                    <span className="pick-check">{on ? '✓' : ''}</span>
                  </span>
                  <span className="pick-name">{it.filename}</span>
                  {it.output_px && <span className="pick-size">{it.output_px.replace('x', ' × ')}</span>}
                </button>
              );
            })}
        </div>

        <div className="lib-foot">
          <span className="hint">
            {picked.length
              ? t('{images} chosen', { images: count(picked.length, t('{n} image'), t('{n} images')) })
              : search || inFolder
                ? t('{images} found', { images: count(filtered.length, t('{n} image'), t('{n} images')) })
                : t('{images} in the library', { images: count(filtered.length, t('{n} image'), t('{n} images')) })}
          </span>
          <div className="row">
            {picked.length > 0 && (
              <button className="pbtn" onClick={() => setPicked([])}>{t('Clear the selection')}</button>
            )}
            <button className="primary narrow" onClick={accept} disabled={!picked.length}>
              {picked.length > 1 ? t('Take {n}', { n: picked.length }) : t('Take')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Styles ---------------- */

function PrintStyles() {
  return <style>{`
    .print{display:block;}

    /* On a desktop: work on the left, look on the right — the preview runs
       along, so that one column does not grow endlessly while the other stays white. */
    .work{display:grid;grid-template-columns:minmax(0,7fr) minmax(340px,5fr);gap:20px;align-items:start;}
    .col{display:flex;flex-direction:column;gap:16px;min-width:0;}
    .work-right{position:sticky;top:82px;}
    @media(max-width:1080px){
      .work{grid-template-columns:1fr;gap:14px;}
      /* On narrow devices the cards run in their own numbering:
         1 Images, 2 Sheet & cut, 3 Preview, 4 Printed last. The right column
         used to stand on top (order:-1, so that the preview is visible at
         once) — with the history card that meant scrolling past a whole block
         before one could even add an image. */
      .work-right{position:static;}
    }

    .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);}
    /* Below 1080 px the preview stands on top — then "1·2·3" would simply be a lie. */
    /* The numbers used to be hidden on narrow devices, because the right column
       was pulled to the top there and the order was no longer 1-2-3-4. Since the
       cards run in their own numbering it is right again — so the numbers may
       stay. */
    .card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);}
    .card-head h2{margin:0;}
    .head-tools{display:flex;gap:16px;align-items:center;}
    .link{background:none;border:none;cursor:pointer;color:var(--accent);font-family:var(--font-mono);
      font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:8px 2px;margin:-8px -2px;}
    .link.danger{color:var(--err);}
    .stage{padding:16px;}

    .drop{width:100%;min-height:190px;border:1.5px dashed var(--line);border-radius:var(--radius-sm);
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;
      padding:26px;cursor:pointer;background:none;font-family:inherit;color:inherit;}
    .drop.drag{border-color:var(--accent);background:var(--accent-bg);}
    .drop-title{font-size:15px;font-weight:600;}
    .drop-hint{color:var(--soft);font-size:12.5px;line-height:1.6;max-width:44ch;}
    .kbd{font-family:var(--font-mono);font-size:12px;background:var(--paper);border:1px solid var(--line);border-radius:3px;padding:1px 6px;}
    /* "or" between the two equal ways into the module */
    .or{display:flex;align-items:center;gap:12px;margin:12px 0;color:var(--soft);
      font-family:var(--font-mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;}
    .or::before,.or::after{content:'';flex:1;height:1px;background:var(--line);}
    .drop-lib{min-height:0;padding:18px;border-style:solid;background:var(--paper);}
    .drop-lib:hover{border-color:var(--accent);}
    .cell-add-group{display:flex;flex-direction:column;gap:8px;align-self:start;}
    .cell-add-group .cell-add{min-height:0;padding:13px;}

    .lib{display:flex;flex-direction:column;max-height:min(86vh,780px);}
    .lib-filter{display:flex;gap:8px;padding:0 16px 12px;}
    .lib-filter .input{flex:1;min-width:0;}
    .lib-filter .select{flex:0 0 auto;max-width:44%;}
    .lib-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;
      padding:12px 16px;border-top:1px solid var(--line);}
    .pick.on{border-color:var(--accent);background:var(--accent-bg);}
    .pick-image{position:relative;display:block;line-height:0;background:var(--paper);}
    .pick-check{position:absolute;top:5px;left:5px;width:22px;height:22px;border-radius:50%;
      border:1.5px solid #fff;background:rgba(22,21,15,.4);color:#fff;display:flex;
      align-items:center;justify-content:center;font-size:12px;line-height:1;}
    .pick.on .pick-check{background:var(--accent);border-color:var(--card);}
    .pick-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .pick-size{display:block;font-family:var(--font-mono);font-size:9px;letter-spacing:.08em;color:var(--soft);}
    @media(max-width:640px){
      .lib-filter{flex-direction:column;}
      .lib-filter .select{max-width:none;}
      .lib-foot{flex-direction:column;align-items:stretch;gap:8px;}
      .lib-foot .row{display:flex;gap:8px;}
      .lib-foot .row>*{flex:1;}
    }

    .history{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper);}
    .history>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;
      justify-content:space-between;gap:10px;padding:12px;font-size:13.5px;}
    .history>summary::-webkit-details-marker{display:none;}
    .history>summary::after{content:'▾';color:var(--soft);font-size:11px;transition:transform .15s;}
    .history[open]>summary::after{transform:rotate(180deg);}
    .history>summary em{font-style:normal;font-size:11.5px;color:var(--soft);margin-left:auto;}
    /* On a phone the addition wraps and turns the line into a block. */
    @media(max-width:560px){ .history>summary em{display:none;} }
    .history-body{padding:0 12px 12px;}

    .quickstart{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);}
    .quick-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}

    .cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;align-items:start;}
    .cell{position:relative;border:1px solid var(--line);border-radius:var(--radius-sm);background:#fff;
      padding:9px;display:flex;flex-direction:column;gap:8px;}
    .cell.err{border-color:var(--err);}
    .cell-x{position:absolute;top:5px;right:5px;z-index:3;width:26px;height:26px;border:none;border-radius:50%;
      background:rgba(22,21,15,.72);color:#fff;cursor:pointer;font-size:13px;line-height:1;}
    .cell-image{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:3px;cursor:zoom-in;
      padding:0;width:100%;display:block;
      background:repeating-conic-gradient(oklch(90% 0.006 95) 0% 25%, oklch(96% 0.004 95) 0% 50%) 50%/14px 14px;}
    .cell-image:disabled{cursor:default;}
    .cell-image img{display:block;}
    .cell-zoom{position:absolute;left:0;right:0;bottom:0;background:rgba(22,21,15,.62);color:#fff;
      font-family:var(--font-mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;text-align:center;padding:3px 0;}
    .loading{position:absolute;inset:0;background:var(--paper);opacity:.6;}
    .cell-controls{display:flex;flex-direction:column;gap:6px;}
    .cell-row{display:flex;gap:6px;align-items:center;}
    .cell-foot{display:flex;gap:6px;margin-top:2px;}
    .cell-foot .pbtn{flex:1;text-align:center;}
    .cell-add{border:1.5px dashed var(--line);background:none;border-radius:var(--radius-sm);cursor:pointer;
      font-size:13.5px;color:var(--soft);min-height:64px;align-self:start;font-family:inherit;padding:14px;}

    .oversize{border:1px solid var(--warn);background:oklch(72% 0.15 75 / .07);border-radius:3px;padding:8px;
      display:flex;flex-direction:column;gap:6px;font-size:11.5px;}
    .oversize b{font-size:11.5px;}

    .count{display:flex;align-items:center;border:1px solid var(--line);border-radius:3px;overflow:hidden;background:#fff;}
    .count button{width:30px;height:32px;border:none;background:none;cursor:pointer;font-size:15px;color:var(--ink);}
    .count input{width:44px;height:32px;border:none;text-align:center;font-family:var(--font-mono);font-size:13px;
      outline:none;-moz-appearance:textfield;}
    .count input::-webkit-outer-spin-button,.count input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}

    .controls{padding:16px;display:flex;flex-direction:column;gap:14px;}
    /* Only real section labels in uppercase mono — otherwise it catches the
       checkboxes too and whole sentences turn into spaced-out capitals. */
    .field > label:not(.check):not(.mini){display:block;font-family:var(--font-mono);font-size:10px;
      letter-spacing:.16em;text-transform:uppercase;color:var(--soft);margin-bottom:7px;}
    .input,.select{width:100%;background:#fff;border:1px solid var(--line);border-radius:3px;padding:9px 11px;
      font-family:var(--font-sans);font-size:14px;color:var(--ink);outline:none;}
    .mini-select,.mini-input{padding:7px 9px;font-size:12.5px;}
    .input:focus,.select:focus{border-color:var(--accent);}
    .row{display:flex;gap:6px;align-items:center;margin-top:6px;}
    .row .select{flex:1;min-width:0;}
    .row.two{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
    .mini{display:block;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft);}
    .mini .input,.mini .select{margin-top:4px;font-family:var(--font-sans);text-transform:none;letter-spacing:0;}
    .mini.wide{width:100%;}
    .mini input[type=range]{width:100%;accent-color:var(--accent);margin-top:6px;}
    .hint{font-size:11.5px;color:var(--soft);margin-top:6px;line-height:1.55;}
    .hint.nopad{margin:0;}
    .hint.center{text-align:center;}
    .hint.warn{color:var(--err);}
    .hint.caution{color:oklch(52% 0.13 75);}
    .check{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:12.5px;color:var(--ink);
      text-transform:none;letter-spacing:0;font-family:var(--font-sans);cursor:pointer;}
    .check input{width:16px;height:16px;accent-color:var(--accent);margin-top:2px;flex:0 0 auto;}
    .check.tiny{font-size:11.5px;color:var(--soft);margin-top:2px;}
    .toggle{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
    .toggle button{flex:1 1 92px;background:#fff;border:1px solid var(--line);border-radius:3px;padding:9px 6px;
      cursor:pointer;font-family:inherit;font-size:13px;color:var(--soft);min-width:0;}
    .toggle button.on{border-color:var(--accent);background:var(--accent-bg);color:var(--ink);font-weight:600;}
    .toggle.soft button{flex:1 1 0;font-size:12px;padding:7px 4px;}
    .toggle.tiny{margin:0;flex:1;}
    .toggle.tiny button{flex:1 1 0;padding:6px 4px;font-size:11.5px;}
    .toggle.tiny.full{flex:none;width:100%;}
    .edge-color{display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--soft);}
    .edge-color .swatch{width:20px;height:20px;border:1px solid var(--line);border-radius:3px;cursor:pointer;padding:0;}
    .edge-color .swatch.on{outline:2px solid var(--accent);outline-offset:1px;}
    .edge-color input[type=color]{width:26px;height:22px;border:1px solid var(--line);border-radius:3px;background:none;padding:1px;cursor:pointer;}
    .pbtn{background:#fff;border:1px solid var(--line);border-radius:3px;padding:9px 11px;cursor:pointer;
      font-family:inherit;font-size:12px;color:var(--ink);white-space:nowrap;}
    .pbtn.wide{width:100%;}
    .pbtn:disabled{color:var(--soft);background:var(--paper);cursor:not-allowed;}

    /* Settings groups — open on a desktop, folded away on a phone */
    .group{border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper);}
    .group > summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;
      gap:10px;padding:10px 12px;}
    .group > summary::-webkit-details-marker{display:none;}
    .group > summary::after{content:'▾';color:var(--soft);font-size:11px;transition:transform .15s;}
    .group[open] > summary::after{transform:rotate(180deg);}
    .group > summary em{font-style:normal;font-size:11px;color:var(--soft);margin-left:auto;margin-right:4px;}
    .group-body{padding:0 12px 12px;}
    .groups{display:grid;gap:12px;align-items:start;}
    @media(min-width:1200px){
      .groups{grid-template-columns:repeat(2,minmax(0,1fr));}
      /* Folded away they sit side by side in pairs, open they take the full
         width — otherwise three-way toggles like "None/Corner marks/Continuous"
         squeeze into 50 px and the text breaks off. */
      .groups .group[open]{grid-column:1 / -1;}
    }

    .finish{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;}
    .primary{width:100%;border:none;border-radius:3px;padding:14px;cursor:pointer;background:var(--accent);color:#fff;
      font-family:inherit;font-weight:600;font-size:15px;}
    .primary.narrow{width:auto;padding:10px 16px;font-size:13.5px;}
    .primary:disabled{background:var(--paper);color:var(--soft);border:1px solid var(--line);cursor:not-allowed;}
    .spin{width:13px;height:13px;display:inline-block;border:2px solid currentColor;border-top-color:transparent;
      border-radius:50%;vertical-align:-2px;margin-right:9px;animation:sp 1s linear infinite;}
    @keyframes sp{to{transform:rotate(360deg);}}

    .preview{padding:16px;display:flex;flex-direction:column;gap:10px;}
    .empty{color:var(--soft);font-size:13px;margin:0;text-align:center;padding:30px 10px;line-height:1.6;}
    .deadend{border:1px solid var(--err);background:oklch(55% 0.19 25 / .05);border-radius:3px;padding:12px;font-size:13px;}
    .deadend p{margin:0 0 6px;line-height:1.55;}
    .sheet-nav{display:flex;align-items:center;justify-content:center;gap:10px;}
    .sheet-no{font-family:var(--font-mono);font-size:11px;letter-spacing:.1em;color:var(--soft);}
    .sheet-holder{display:flex;justify-content:center;}
    .sheet{position:relative;width:100%;max-width:min(100%, calc(62vh * (var(--ar, 0.7))));background:#fff;
      border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden;}
    .slot{position:absolute;overflow:hidden;}
    .rotor{position:absolute;left:50%;top:50%;width:100%;height:100%;transform:translate(-50%,-50%);overflow:hidden;}
    .rotor img{position:absolute;}
    .slot-size{position:absolute;left:0;bottom:0;background:rgba(22,21,15,.55);color:#fff;
      font-family:var(--font-mono);font-size:7.5px;letter-spacing:.06em;padding:1px 3px;pointer-events:none;}
    .marks{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
    .sheet-foot{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;
      color:var(--soft);text-align:center;}
    .alert{color:var(--err);font-size:12px;margin:0;line-height:1.5;}

    .modal{position:fixed;inset:0;background:rgba(22,21,15,.55);display:flex;align-items:center;justify-content:center;
      z-index:70;padding:16px;}
    .modal-body{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
      width:min(560px,100%);max-height:92vh;overflow:auto;}
    .modal-body.wide{width:min(880px,100%);}
    .crop-stage{padding:16px;display:flex;justify-content:center;background:var(--paper);}
    /* Do not clamp the height — otherwise the frame gets a different ratio than
       the target format and the image looks distorted. Width from height × ratio. */
    .crop-box{--croph:52vh;position:relative;width:100%;max-width:min(420px, calc(var(--croph) * var(--ar)));
      aspect-ratio:var(--ar);overflow:hidden;background:#fff;border:1px solid var(--line);
      cursor:grab;touch-action:none;user-select:none;}
    .crop-box:active{cursor:grabbing;}
    .crop-box img{position:absolute;pointer-events:none;}
    .crop-grid{position:absolute;inset:0;pointer-events:none;
      background:linear-gradient(to right,transparent calc(33.33% - .5px),rgba(255,255,255,.55) 33.33%,rgba(255,255,255,.55) calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),rgba(255,255,255,.55) 66.66%,rgba(255,255,255,.55) calc(66.66% + .5px),transparent calc(66.66% + .5px)),
                 linear-gradient(to bottom,transparent calc(33.33% - .5px),rgba(255,255,255,.55) 33.33%,rgba(255,255,255,.55) calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),rgba(255,255,255,.55) 66.66%,rgba(255,255,255,.55) calc(66.66% + .5px),transparent calc(66.66% + .5px));
      box-shadow:inset 0 0 0 1px rgba(27,59,224,.35);}
    .crop-controls{padding:14px 16px;display:flex;flex-direction:column;gap:8px;}
    .pan{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink);background:var(--accent-bg);
      border-left:3px solid var(--accent);padding:7px 10px;border-radius:3px;line-height:1.45;}
    .pan.fixed{background:var(--paper);border-left-color:var(--line);color:var(--soft);}
    .pan-arrows{font-size:15px;line-height:1;color:var(--accent);}
    .pan.fixed .pan-arrows{color:var(--soft);}

    .picker{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;}
    .pick{border:1px solid var(--line);background:#fff;border-radius:3px;padding:0;cursor:pointer;overflow:hidden;
      display:flex;flex-direction:column;font-family:inherit;}
    .pick img{width:100%;aspect-ratio:1;object-fit:cover;display:block;}
    /* Pad only the text lines: a selector on all spans would also hit the
       wrapper around the image and would have shifted the tick. */
    .pick-name,.pick-size{font-size:10px;color:var(--soft);padding:4px 5px 0;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .pick-size{padding-bottom:5px;}
    .pick:hover{border-color:var(--accent);}

    .toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--ink);color:#FBFBF7;
      padding:11px 16px;border-radius:4px;font-size:13.5px;z-index:80;max-width:min(92vw,540px);line-height:1.5;
      display:flex;gap:12px;align-items:flex-start;box-shadow:0 6px 24px rgba(22,21,15,.25);}
    .toast button{background:none;border:none;color:#FBFBF7;cursor:pointer;font-size:14px;padding:0 2px;flex:0 0 auto;}

    /* ---------- Tablet ---------- */
    @media(max-width:1080px) and (min-width:721px){
      .cells{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));}
      .sheet{max-width:min(520px,100%);}
    }

    /* ---------- Phone: like an app ---------- */
    @media(max-width:720px){
      .work{gap:12px;}
      .col{gap:12px;}
      .stage,.controls,.preview{padding:12px;}
      .card-head{padding:11px 12px;}
      .cells{grid-template-columns:1fr;gap:10px;}
      .cell{flex-direction:row;gap:12px;align-items:flex-start;padding:8px;}
      .cell-image{flex:0 0 32%;max-width:132px;}
      .cell-controls{flex:1;min-width:0;}
      /* Next to the preview image about 180 px are left — "Portrait/Landscape"
         and the counter do not fit side by side there, so they wrap instead of
         being cut off. */
      .cell-row{flex-wrap:wrap;}
      .toggle.tiny button{min-width:60px;}
      .cell-controls .mini-select{padding-right:32px;}
      .cell-add{min-height:52px;padding:12px;}
      .toggle button{padding:11px 6px;font-size:13px;}
      .toggle.tiny button{padding:9px 4px;font-size:12px;}
      .toggle.soft button{padding:10px 4px;font-size:12px;}
      .count button{width:36px;height:38px;font-size:18px;}
      .count input{height:38px;width:40px;}
      /* On a phone the image is on the left and the controls on the right — the
         close button then belongs on the image and not above the format field. */
      .cell-x{width:30px;height:30px;font-size:15px;top:12px;left:12px;right:auto;}
      .pbtn{padding:11px 12px;}
      .input,.select{padding:11px;}
      .check input{width:18px;height:18px;}
      .edge-color .swatch{width:24px;height:24px;}
      /* Settings folded away — the preview should not scroll out of sight */
      .group{background:var(--card);}
      .group:not([open]) > summary{border-bottom:none;}
      .drop{min-height:150px;padding:20px;}
      .drop-hint{font-size:12px;}
      /* The closing block sticks to the bottom like an app bar */
      .finish{position:sticky;bottom:calc(66px + env(safe-area-inset-bottom));z-index:12;
        box-shadow:0 -8px 20px oklch(21% .01 95 / .13);}
      .finish .primary{padding:15px;}
      .sheet{max-width:100%;}
      .modal{padding:0;align-items:flex-end;}
      .modal-body{width:100%;max-height:100vh;border-radius:0;border-left:none;border-right:none;
        padding-bottom:env(safe-area-inset-bottom);}
      .crop-stage{padding:10px;}
      .crop-box{--croph:44vh;max-width:min(100%, calc(var(--croph) * var(--ar)));}
      .crop-controls .row{flex-wrap:wrap;}
      .crop-controls .primary.narrow{flex:1 1 100%;padding:13px;}
      .picker{grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;}
      .toast{bottom:calc(140px + env(safe-area-inset-bottom));}
    }
    @media(max-width:400px){
      .row.two{grid-template-columns:1fr;}
      .cell-image{flex-basis:42%;}
    }
    @media (prefers-reduced-motion: reduce){ .spin{animation:none;} }
  `}</style>;
}
