import type { APIRoute } from 'astro';
import { buildSelectionZipName } from '../../../lib/naming';
import archiver from 'archiver';
import { query } from '../../../lib/db';
import { getObject } from '../../../lib/storage';

export const prerender = false;

/** Downloads several results as a ZIP. Body { itemIds: [...] } */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json().catch(() => ({} as any));
  const ids: string[] = b.itemIds || [];
  if (!ids.length) return new Response('Nothing selected.', { status: 400 });

  const rows = await query<{ id: string; result_path: string | null; filename: string | null }>(
    `SELECT id, result_path, filename FROM items WHERE id = ANY($1) AND result_path IS NOT NULL`, [ids]);
  if (!rows.length) return new Response('No results.', { status: 404 });

  const archive = archiver('zip', { zlib: { level: 6 } });
  const seen: Record<string, number> = {};
  for (const r of rows) {
    try {
      const buf = await getObject(r.result_path!);
      let name = r.filename || `${r.id}.png`;
      if (!/\.[a-z0-9]+$/i.test(name)) name += '.png';
      // Avoid name collisions
      if (seen[name] != null) { const n = ++seen[name]; name = name.replace(/(\.[^.]+)$/, `_${n}$1`); }
      else seen[name] = 0;
      archive.append(buf, { name });
    } catch { /* skip the file */ }
  }
  const done = archive.finalize();

  // Turn the archiver stream (Node) into a web ReadableStream.
  const stream = new ReadableStream({
    start(controller) {
      archive.on('data', (c: Buffer) => controller.enqueue(new Uint8Array(c)));
      archive.on('end', () => controller.close());
      archive.on('error', (e: any) => controller.error(e));
      done.catch(() => {});
    },
  });
  // Unique rather than only dated: two selections on the same day had the same name.
  const name = buildSelectionZipName(rows.length);
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
};
