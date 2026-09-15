// Resolving the image sources for the print sheet: freshly uploaded or from the library.
import { one } from './db';
import { getObject } from './storage';

export type PrintSource =
  | { kind: 'upload'; path: string }
  | { kind: 'item'; id: string };

export interface SessionUser { uid: string | null; role: string }

/** Loads the image data and checks the access rights while doing so, like /api/items/:id/file. */
export async function loadSource(src: PrintSource, user: SessionUser): Promise<Buffer> {
  return (await loadSourceNamed(src, user)).buffer;
}

export interface LoadedSource {
  buffer: Buffer;
  /** Original file name, as far as it is known — for the name of the output file. */
  filename: string | null;
  /** Id of the library image, otherwise null — supplies the short id in the name. */
  itemId: string | null;
}

/** Like `loadSource`, but also returns the name of the source. */
export async function loadSourceNamed(src: PrintSource, user: SessionUser): Promise<LoadedSource> {
  if (!src || typeof src !== 'object') throw new Error('Source missing.');

  if (src.kind === 'upload') {
    // Only the upload area can be reached — no route to results/ or /etc.
    const p = String(src.path || '');
    // \n deliberately excluded: JS "$" also matches before a trailing line break.
    if (/[\r\n]/.test(p) || !/^sources\/[0-9]{4}\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5}$/.test(p))
      throw new Error('Invalid source.');
    return { buffer: await getObject(p), filename: p.split('/').pop() || null, itemId: null };
  }

  if (src.kind === 'item') {
    const item = await one<any>(
      `SELECT i.result_path, i.filename, j.created_by, j.private
         FROM items i JOIN jobs j ON j.id = i.job_id WHERE i.id = $1`, [src.id]);
    if (!item?.result_path) throw new Error('Image not found.');
    const isAdmin = user.role === 'admin';
    const own = item.created_by === user.uid;
    if (!isAdmin && !own) {
      const s = await one<{ library_visibility: string }>('SELECT library_visibility FROM settings WHERE id=1');
      if (item.private || s?.library_visibility !== 'shared') throw new Error('No access to this image.');
    }
    return { buffer: await getObject(item.result_path), filename: item.filename ?? null, itemId: String(src.id) };
  }

  throw new Error('Unknown kind of source.');
}

// `sheetFilename` is gone: all it did was put the date in front of the name, so
// two sheets from the same day were called the same. The naming rules now live
// in full in `naming.ts` — the same ones as for library results.
