import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { one } from '../../../../lib/db';
import { getObject } from '../../../../lib/storage';

export const prerender = false;

// Streams the result (or source) image out of object storage.
export const GET: APIRoute = async ({ params, url, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const q = url.searchParams;
  const wantThumb = q.get('thumb') === '1';
  const wantSrc = q.get('src') === '1';
  const item = await one<any>(
    `SELECT i.source_path, i.source_paths, i.result_path, i.thumb_path, i.filename, i.has_alpha,
            j.created_by, j.private FROM items i JOIN jobs j ON j.id=i.job_id WHERE i.id=$1`, [params.id]);
  if (item) {
    const isAdmin = locals.user.role === 'admin';
    const own = item.created_by === locals.user.uid;
    if (!isAdmin && !own) {
      const s = await one<{ library_visibility: string }>('SELECT library_visibility FROM settings WHERE id=1');
      if (item.private || s?.library_visibility !== 'shared') return new Response('Forbidden', { status: 403 });
    }
  }
  // Source: the single source, otherwise the first combine source (for before/after).
  const firstSource = item?.source_path || (Array.isArray(item?.source_paths) ? item.source_paths[0] : null);
  const path = wantSrc ? firstSource
    : wantThumb ? (item?.thumb_path || item?.result_path)
    : item?.result_path;
  if (!path) return new Response('Not found', { status: 404 });
  try {
    let buf = await getObject(path);
    const download = q.get('download') === '1';
    // Derive the content type from the magic bytes — results can be PNG or JPG.
    const sniff = (b: Buffer): string =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
      : b.length > 12 && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
      : 'image/png';
    let contentType = path.endsWith('.webp') ? 'image/webp' : sniff(buf);
    // Fast full-screen preview: non-transparent results as JPEG (much smaller and
    // faster on a phone) — enough for "save to photos". The PNG download is unchanged.
    if (q.get('preview') === '1' && !download && !item?.has_alpha) {
      try { buf = await sharp(buf, { failOn: 'none' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(); contentType = 'image/jpeg'; }
      catch { /* fall back to the original */ }
    }
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=600',
        ...(download ? { 'Content-Disposition': `attachment; filename="${item.filename || 'klarbild.png'}"` } : {}),
      },
    });
  } catch {
    return new Response('File not available', { status: 404 });
  }
};
