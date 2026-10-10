// Who may do what with an image.
//
// One rule, in one place. Before this file, only the file route checked access;
// renaming, deleting, retrying and zipping took any id from any signed-in user.
// On a single-user install that changes nothing. On a family install it meant
// one account could delete another account's images by id.
import { one } from './db.ts';

export interface Viewer { uid: string | null; role: string }

export interface ItemAccessRow {
  id: string;
  created_by: string | null;
  private: boolean | null;
  deleted_at: string | null;
}

/** Reading: your own images, everything as admin, others' only in a shared library and never from a private session. */
export function canRead(v: Viewer, it: Pick<ItemAccessRow, 'created_by' | 'private'>, libraryShared: boolean): boolean {
  if (v.role === 'admin') return true;
  if (v.uid && it.created_by === v.uid) return true;
  return libraryShared && !it.private;
}

/** Changing or deleting: only your own images, or as admin. A shared library is for looking, not for tidying up other people's work. */
export function canWrite(v: Viewer, it: Pick<ItemAccessRow, 'created_by'>): boolean {
  if (v.role === 'admin') return true;
  return !!v.uid && it.created_by === v.uid;
}

/**
 * Loads an image together with what the access decision needs.
 * Returns null both for "does not exist" and for "not yours" — a caller must not
 * be able to tell the two apart by trying ids.
 */
export async function loadItemFor(
  v: Viewer, id: string, mode: 'read' | 'write', opts: { includeTrashed?: boolean } = {},
): Promise<ItemAccessRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const it = await one<ItemAccessRow & { library_visibility: string | null }>(
    `SELECT i.id, j.created_by, j.private, i.deleted_at,
            (SELECT library_visibility FROM settings WHERE id=1) AS library_visibility
       FROM items i LEFT JOIN jobs j ON j.id = i.job_id
      WHERE i.id = $1`, [id]);
  if (!it) return null;
  if (it.deleted_at && !opts.includeTrashed) return null;
  const ok = mode === 'write' ? canWrite(v, it) : canRead(v, it, it.library_visibility === 'shared');
  return ok ? it : null;
}
