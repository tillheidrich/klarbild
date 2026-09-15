import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { putObject, sourceKey } from '../../lib/storage';
import { heicToPng } from '../../lib/pipeline';

export const prerender = false;

const MAX_BYTES = 25 * 1024 * 1024;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const form = await request.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!files.length) return json({ error: 'No files.' }, 400);

  const out: any[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) { out.push({ filename: file.name, error: 'Larger than 25 MB.' }); continue; }
    const isImg = OK_TYPES.includes(file.type) || /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name);
    if (!isImg) { out.push({ filename: file.name, error: 'Unsupported format.' }); continue; }

    try {
      let buf: Buffer = Buffer.from(await file.arrayBuffer());
      let ext = 'png';
      const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
      if (heic) buf = await heicToPng(buf);
      else {
        const meta = await sharp(buf, { failOn: 'none' }).metadata();
        ext = meta.format === 'jpeg' ? 'jpg' : (meta.format || 'png');
      }
      const meta = await sharp(buf, { failOn: 'none' }).metadata();
      // Take the EXIF rotation into account: the browser shows the image oriented,
      // so the reported dimensions have to be oriented too (cropping in the print module).
      const turned = (meta.orientation ?? 1) >= 5;
      const key = sourceKey(randomUUID(), ext);
      await putObject(key, buf, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
      out.push({
        source_path: key, filename: file.name,
        width: turned ? meta.height : meta.width,
        height: turned ? meta.width : meta.height,
        source_quality: 'original',
      });
    } catch (e: any) {
      out.push({ filename: file.name, error: 'Could not be read.' });
    }
  }
  return json({ files: out });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
