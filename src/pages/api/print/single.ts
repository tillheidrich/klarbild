import type { APIRoute } from 'astro';
import { renderCell, type CropRel } from '../../../lib/printrender';
import { loadSourceNamed, type PrintSource } from '../../../lib/printsource';
import { buildSingleFilename } from '../../../lib/naming';
import { parseSizeMm, mmToPx, labelMm } from '../../../lib/paper';
import { dpiCheck } from '../../../lib/printlayout';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/**
 * Bring a single image to an exact size — no AI, no sheet.
 * Response: the finished image file (PNG/JPG) with dpi metadata.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  try {
    const src: PrintSource = body?.src;
    const crop: CropRel | null = body?.crop ?? null;
    let size = (Number(body?.wMm) > 0 && Number(body?.hMm) > 0)
      ? { w: Number(body.wMm), h: Number(body.hMm) }
      : parseSizeMm(String(body?.size || ''));
    if (!size) return json({ error: 'Size is missing or invalid.' }, 400);
    if (body?.landscape) size = { w: size.h, h: size.w };
    if (size.w < 5 || size.h < 5 || size.w > 2000 || size.h > 2000) return json({ error: 'Size is outside the allowed range.' }, 400);

    const dpi = Math.min(1200, Math.max(72, Number(body?.dpi) || 300));
    const ext: 'jpg' | 'png' = body?.ext === 'png' ? 'png' : 'jpg';
    const source = await loadSourceNamed(src, locals.user as any);
    const buf = source.buffer;
    const fit = body?.fit === 'contain' ? 'contain' : 'cover';
    const background = /^#[0-9a-f]{6}$/i.test(String(body?.bg || '')) ? String(body.bg) : '#ffffff';
    const out = await renderCell(buf, crop, size.w, size.h, dpi,
      { ext, bleedMm: Math.min(10, Math.max(0, Number(body?.bleedMm) || 0)), fit, background });

    // A hint in case the source is too small for real 300 dpi.
    const cropW = (crop?.w ?? 1) * out.srcPx[0];
    const check = dpiCheck(cropW, size.w, dpi);

    return new Response(new Uint8Array(out.buffer), {
      headers: {
        'Content-Type': out.ext === 'png' ? 'image/png' : 'image/jpeg',
        'Content-Disposition': `attachment; filename="${buildSingleFilename({
          name: body?.name, sourceName: source.filename,
          wMm: size.w, hMm: size.h, ext: out.ext, id: source.itemId,
        })}"`,
        'X-Klarbild-Px': `${out.width}x${out.height}`,
        'X-Klarbild-Real-Dpi': String(check.dpi),
        'X-Klarbild-Dpi-Ok': check.ok ? '1' : '0',
      },
    });
  } catch (e: any) {
    console.error('[print/single]', e?.message || e);
    const m = String(e?.message || '');
    const safe = /^(Size|Invalid|Unknown|Image not|No access|Source|Crop|Target image)/.test(m);
    return json({ error: safe ? m : 'The image could not be created.' }, 400);
  }
};

/** A small helper for scripts and MCP: size → pixels at a given dpi. */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const size = parseSizeMm(url.searchParams.get('size') || '');
  const dpi = Math.min(1200, Math.max(72, Number(url.searchParams.get('dpi')) || 300));
  if (!size) return json({ error: 'The size parameter is missing (e.g. 12x15 or 35x45mm).' }, 400);
  return json({ mm: size, dpi, px: { w: mmToPx(size.w, dpi), h: mmToPx(size.h, dpi) }, label: labelMm(size.w, size.h) });
};
