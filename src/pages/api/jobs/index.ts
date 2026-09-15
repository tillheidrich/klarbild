import type { APIRoute } from 'astro';
import { one, query } from '../../../lib/db';
import { enqueue } from '../../../lib/queue';
import { has, moduleOff } from '../../../lib/modules';

export const prerender = false;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const s = await one<any>('SELECT library_visibility, anonymous_generations FROM settings WHERE id=1');
  const isAdmin = locals.user.role === 'admin';
  const shared = s?.library_visibility === 'shared';
  const where: string[] = ['j.private=false']; const args: any[] = [];
  if (!isAdmin && !shared) { args.push(locals.user.uid); where.push(`j.created_by=$${args.length}`); }
  const nameCol = (s?.anonymous_generations && !isAdmin) ? 'NULL' : 'u.display_name';
  const rows = await query(
    `SELECT j.*, ${nameCol} AS by_name FROM jobs j
       LEFT JOIN users u ON u.id=j.created_by
      WHERE ${where.join(' AND ')} ORDER BY j.created_at DESC LIMIT 50`, args);
  return json({ jobs: rows });
};

// Body: { recipeId?, recipe?, sources:[{source_path, filename, source_quality?}],
//         mode?: 'each'|'compose'|'generate', prompt_text?, origin? }
export const POST: APIRoute = async ({ request, locals }) => {
  if (!has('ai')) return moduleOff('ai');
  if (!locals.user) return new Response('Unauthorized', { status: 401 });
  const b = await request.json();
  const mode: 'each' | 'compose' | 'generate' = ['each', 'compose', 'generate'].includes(b.mode) ? b.mode : 'each';
  const sources: any[] = b.sources || [];
  const promptText: string = (b.prompt_text || '').trim();

  if (mode === 'each' && !sources.length) return json({ error: 'No images.' }, 400);
  if (mode === 'compose' && sources.length < 1) return json({ error: 'At least 1 image is required.' }, 400);
  if (mode === 'compose' && !promptText) return json({ error: 'Please describe what should come out.' }, 400);
  if (mode === 'generate' && !promptText) return json({ error: 'Please enter some text.' }, 400);

  let snapshot: any = b.recipe;
  if (b.recipeId) {
    const r = await one('SELECT * FROM recipes WHERE id=$1', [b.recipeId]);
    if (!r) return json({ error: 'Preset recipe not found.' }, 404);
    snapshot = r;
  }
  snapshot = snapshot || {};

  // Freeze the preset recipe as a snapshot
  const snap = {
    tasks: snapshot.tasks || (mode === 'each' ? [] : []),
    output_format: snapshot.output_format,
    orientation: snapshot.orientation,
    crop_mode: snapshot.crop_mode || 'crop',
    dpi: snapshot.dpi || 300,
    contour_mm: snapshot.contour_mm ?? null,
    model_key: snapshot.model_key ?? null,
    custom_instruction: snapshot.custom_instruction ?? null,
    prompt_text: promptText || null,
    delivery: snapshot.delivery || 'library',
    delivery_folder: snapshot.delivery_folder ?? null,
    delivery_target_id: snapshot.delivery_target_id ?? null,
    output_ext: (snapshot.output_ext === 'jpg' || snapshot.output_ext === 'png') ? snapshot.output_ext : null,
  };

  // Private session: only if allowed globally or forced for the user.
  const acc = await one<any>(`SELECT s.private_allowed, u.private_forced
    FROM settings s, users u WHERE s.id=1 AND u.id=$1`, [locals.user.uid]);
  const isPrivate = !!(acc?.private_forced || (acc?.private_allowed && b.private));
  if (isPrivate) snap.delivery = 'library'; // no external delivery for private jobs

  const total = (mode === 'each') ? sources.length : 1;
  const job = await one<{ id: string }>(
    `INSERT INTO jobs (created_by, origin, mode, recipe_snapshot, status, total, private)
     VALUES ($1,$2,$3,$4,'queued',$5,$6) RETURNING id`,
    [locals.user.uid, b.origin || 'web', mode, JSON.stringify(snap), total, isPrivate]);

  if (mode === 'each') {
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const item = await one<{ id: string }>(
        `INSERT INTO items (job_id, position, status, source_path, filename, source_quality)
         VALUES ($1,$2,'queued',$3,$4,$5) RETURNING id`,
        [job!.id, i, s.source_path, s.filename || null, s.source_quality || 'original']);
      await enqueue({ itemId: item!.id, jobId: job!.id });
    }
  } else {
    const srcPaths = sources.map((s) => s.source_path).filter(Boolean);
    // File name stem, also written by src/lib/telegram.ts — kept identical there.
    const base = mode === 'generate' ? 'new' : 'combined';
    const item = await one<{ id: string }>(
      `INSERT INTO items (job_id, position, status, source_paths, filename, source_quality)
       VALUES ($1,0,'queued',$2,$3,'original') RETURNING id`,
      [job!.id, srcPaths.length ? JSON.stringify(srcPaths) : null, base]);
    await enqueue({ itemId: item!.id, jobId: job!.id });
  }

  return json({ jobId: job!.id });
};
