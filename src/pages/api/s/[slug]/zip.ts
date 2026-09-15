import type { APIRoute } from 'astro';
import archiver from 'archiver';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { query } from '../../../../lib/db';
import { getObject } from '../../../../lib/storage';
import { resolveShare, shareItems, trackShare, proofValid, proofFromCookie,
  archiveName, packageName } from '../../../../lib/shares';
import { tooOften, realIp } from '../../../../lib/limit';
import { has, moduleOff } from '../../../../lib/modules';

export const prerender = false;

/** Upper limits. A ZIP is the most expensive way to pull data out of this server. */
const MAX_FILES = 200;
const MAX_BYTES = 500 * 1024 * 1024;   // 500 MB unpacked

/**
 * All images of a share link as a ZIP.
 *
 * Deliberately **GET**: that makes it a plain link on the page which works even
 * without JavaScript — and the recipient is often on a phone.
 *
 * Unlike `/api/items/zip` (for signed-in users), here **one file after another**
 * is read and passed on: after every `append` the code waits for the `entry`
 * event. Otherwise twenty posters would quickly put a few gigabytes into memory
 * at the same time — and `mem_limit` is 3 GB.
 */
export const GET: APIRoute = async ({ params, request, clientAddress }) => {
  if (!has('share')) return moduleOff('share');
  const slug = params.slug!;
  let { status, share } = await resolveShare(slug, null);
  if (status === 'passphrase' && share
      && proofValid(share.id, proofFromCookie(request.headers.get('cookie'), slug))) {
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

  // Whoever blocked the download means the bundle too.
  if (!share.allow_download) {
    return new Response('Downloading is switched off for this link.', { status: 403 });
  }

  // A ZIP costs processing time and bandwidth — not once a second.
  const ip = realIp(request, clientAddress);
  if (tooOften(`zip:${share.id}:${ip}`, 5, 10 * 60_000)) {
    return new Response('Just downloaded a moment ago. Please wait a little.', { status: 429 });
  }

  const images = await shareItems(share.id);
  if (!images.length) return new Response('There are no images for this link.', { status: 404 });
  if (images.length > MAX_FILES) {
    return new Response(`This bundle would be too large (${images.length} images). Please download them one by one.`, { status: 413 });
  }

  const paths = await query<{ id: string; result_path: string; filename: string | null }>(
    `SELECT id, result_path, filename FROM items
      WHERE id = ANY($1::uuid[]) AND result_path IS NOT NULL`,
    [images.map((b) => b.id)]);
  const byId = new Map(paths.map((p) => [p.id, p]));

  const archive = archiver('zip', { zlib: { level: 6 } });
  // Errors must not take the process with them; the stream then breaks off.
  archive.on('error', (e: any) => console.error('[share/zip]', e?.message || e));
  archive.on('warning', (e: any) => console.error('[share/zip] warning:', e?.message || e));

  // The handlers are in place **before** anything is written into it.
  const web = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

  (async () => {
    const taken = new Map<string, number>();
    let bytes = 0;
    try {
      for (const b of images) {
        const p = byId.get(b.id);
        if (!p) continue;
        let buf: Buffer;
        try { buf = await getObject(p.result_path); }
        catch (e: any) { console.error('[share/zip] file missing', p.result_path, e?.message || e); continue; }

        bytes += buf.length;
        if (bytes > MAX_BYTES) {
          archive.append(
            Buffer.from(
              'This bundle was cut off at 500 MB.\r\n'
              + 'The remaining images can be downloaded one by one on the page.\r\n', 'utf8'),
            { name: 'NOTE.txt' });
          break;
        }

        archive.append(buf, { name: archiveName(p.filename, taken) });
        // One file after another: only read on once this one is in the stream.
        await once(archive, 'entry');
      }
    } finally {
      archive.finalize().catch(() => {});
    }
  })();

  await trackShare(share.id, 'download', clientAddress, request.headers.get('user-agent'));

  return new Response(web, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${packageName(share.title)}"`,
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });
};
