import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { one } from '../../../../lib/db';
import { getObject } from '../../../../lib/storage';
import { resolveShare, shareHasItem, trackShare, proofValid, proofFromCookie } from '../../../../lib/shares';
import { has, moduleOff } from '../../../../lib/modules';

export const prerender = false;

/**
 * Serve an image behind a share link — **without a sign-in**.
 *
 * The access check hangs on the link alone, not on the image: only what is in
 * `share_items` comes out. So nobody can fetch someone else's images through a
 * valid link by substituting a different image id.
 */
export const GET: APIRoute = async ({ params, url, request, clientAddress }) => {
  if (!has('share')) return moduleOff('share');
  const q = url.searchParams;
  // No `?pw=` any more: for protected links only the proof counts that the page
  // set as a cookie after checking once. Otherwise argon2 (130 ms, 64 MiB) would
  // run again for every single image — with a gallery of 40 images that is enough
  // to drive the process into the memory limit.
  let { status, share } = await resolveShare(params.slug!, null);
  if (status === 'passphrase' && share
      && proofValid(share.id, proofFromCookie(request.headers.get('cookie'), params.slug!))) {
    status = 'ok';
  }
  if (status !== 'ok' || !share) {
    return new Response(
      status === 'expired' ? 'This link has expired.'
      : status === 'revoked' ? 'This link has been switched off.'
      : status === 'passphrase' ? 'A passphrase is required.'
      : 'Not found.',
      { status: status === 'passphrase' ? 401 : status === 'not-found' ? 404 : 410 });
  }

  const itemId = q.get('item');
  if (!itemId || !/^[0-9a-f-]{36}$/i.test(itemId)) return new Response('Not found.', { status: 404 });
  if (!(await shareHasItem(share.id, itemId))) return new Response('Not found.', { status: 404 });

  const item = await one<any>(
    'SELECT result_path, thumb_path, filename, has_alpha FROM items WHERE id=$1', [itemId]);
  if (!item?.result_path) return new Response('Not found.', { status: 404 });

  const download = q.get('download') === '1';
  const wantThumb = q.get('thumb') === '1';
  // Whoever switched the download off does not hand out the original file either —
  // otherwise the setting would be decoration.
  if (download && !share.allow_download) return new Response('Downloading is off for this link.', { status: 403 });

  const path = wantThumb ? (item.thumb_path || item.result_path) : item.result_path;
  try {
    let buf = await getObject(path);
    const sniff = (b: Buffer): string =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
      : b.length > 12 && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
      : 'image/png';
    let contentType = path.endsWith('.webp') ? 'image/webp' : sniff(buf);

    // Viewing take: smaller and faster, above all on a phone. The download still
    // delivers the untouched original file at full resolution.
    //
    // Important: this did **not** used to apply to cut-out motifs — they went
    // through unfiltered, at full resolution, saveable with a right click. That
    // made "downloading off" useless for exactly stickers and cut-outs. Alpha
    // images are therefore scaled down as PNG instead of being skipped.
    if (!download && !wantThumb) {
      try {
        const small = sharp(buf, { failOn: 'none', limitInputPixels: 400_000_000 })
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true });
        if (item.has_alpha) { buf = await small.png({ compressionLevel: 8 }).toBuffer(); contentType = 'image/png'; }
        else { buf = await small.jpeg({ quality: 88, mozjpeg: true }).toBuffer(); contentType = 'image/jpeg'; }
      } catch (e: any) {
        // Only when the download is blocked is the original off limits — then it
        // is better to serve nothing than to serve full resolution by accident.
        console.error('[share] viewing take failed:', e?.message || e);
        if (!share.allow_download) return new Response('Preview not available.', { status: 503 });
      }
    }

    if (download) {
      await trackShare(share.id, 'download', clientAddress, request.headers.get('user-agent'));
    }

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      // Not into search engines and not into anyone else's cache.
      'X-Robots-Tag': 'noindex, nofollow, noarchive, noimageindex',
      'Cache-Control': 'private, max-age=300',
    };
    if (download) {
      const name = (item.filename || 'klarbild.jpg').replace(/[^\w.\-]/g, '_');
      headers['Content-Disposition'] = `attachment; filename="${name}"`;
    }
    return new Response(new Uint8Array(buf), { headers });
  } catch (e: any) {
    // The cause goes into the log — otherwise, during a storage outage, the
    // operator searches in vain while every recipient sees "image no longer there".
    console.error('[share] delivery failed', path, e?.message || e);
    return new Response('This image is no longer there.', { status: 404 });
  }
};
