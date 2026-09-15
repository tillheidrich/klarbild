import { one, query } from './db';
import { getObject, putObject, deleteObject, resultKey, thumbKey } from './storage';
import { generateImage } from './openrouter';
import { buildPrompt, buildComposePrompt, buildGeneratePrompt, type Task } from './prompts';
import { resolveDimensions, aspectRatio, type Orientation } from './format';
import { finalizeToFormat, stickerContour, type CropMode } from './pipeline';
import { formatToken } from './naming';
import { uniqueFilename } from './renames';
import { embedProvenance, TRAINED_ALGORITHMIC_MEDIA, COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA } from './provenance';
import sharp from 'sharp';

const DEFAULT_MODEL = 'google/gemini-3.1-flash-image';

type Mode = 'each' | 'compose' | 'generate';

interface RecipeSnapshot {
  tasks: Task[];
  output_format?: string;
  orientation?: Orientation;
  crop_mode?: CropMode;
  dpi?: number;
  contour_mm?: number | null;
  model_key?: string | null;
  custom_instruction?: string | null;
  prompt_text?: string | null;      // description for compose/generate
  delivery?: 'library' | 'remote' | 'both';
  delivery_folder?: string | null;
  output_ext?: 'png' | 'jpg' | null;   // file-format override; otherwise the global setting
}

/** Which model id + alpha capability? From the models table, otherwise the default. */
async function pickModel(modelKey?: string | null): Promise<{ id: string; alpha: boolean }> {
  if (modelKey) {
    const m = await one<{ model_id: string; supports_alpha: boolean }>(
      'SELECT model_id, supports_alpha FROM models WHERE label=$1 OR model_id=$1 LIMIT 1', [modelKey]);
    if (m) return { id: m.model_id, alpha: m.supports_alpha };
  }
  const def = await one<{ model_id: string; supports_alpha: boolean }>(
    'SELECT model_id, supports_alpha FROM models WHERE active AND is_default ORDER BY sort LIMIT 1');
  if (def) return { id: def.model_id, alpha: def.supports_alpha };
  return { id: DEFAULT_MODEL, alpha: true };
}

async function toDataUrl(buf: Buffer): Promise<string> {
  const small = await sharp(buf, { failOn: 'none' })
    .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${small.toString('base64')}`;
}

/** A small preview image (webp) for the library — saves bandwidth and storage. */
async function makeThumb(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { failOn: 'none' })
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}

export interface ProcessResult { ok: boolean; cost: number; error?: string; }

/** Processes one item completely and updates its record. */
export async function processItem(itemId: string): Promise<ProcessResult> {
  const item = await one<{ id: string; job_id: string; source_path: string | null; source_paths: string[] | null; filename: string | null }>(
    'SELECT id, job_id, source_path, source_paths, filename FROM items WHERE id=$1', [itemId]);
  if (!item) return { ok: false, cost: 0, error: 'Item not found' };

  const job = await one<{ recipe_snapshot: RecipeSnapshot; mode: Mode; private: boolean }>(
    'SELECT recipe_snapshot, mode, private FROM jobs WHERE id=$1', [item.job_id]);
  const r = (job?.recipe_snapshot || {}) as RecipeSnapshot;
  const mode: Mode = job?.mode || 'each';
  const isPrivate = !!job?.private;
  const tasks = r.tasks || [];
  const dpi = r.dpi ?? 300;
  const cropMode: CropMode = r.crop_mode === 'extend' ? 'extend' : 'crop';
  const wantCutout = tasks.includes('cutout');
  const wantContour = tasks.includes('contour');
  const description = (r.prompt_text || '').trim();

  await query(`UPDATE items SET status='running', attempts=attempts+1 WHERE id=$1`, [itemId]);

  try {
    // Collect the sources per mode
    const sourceKeys: string[] =
      mode === 'compose' ? (item.source_paths || []).filter(Boolean)
      : mode === 'generate' ? []
      : (item.source_path ? [item.source_path] : []);
    // Does this mode need a source but there is none (any more)? A clear message instead of a raw fs error.
    if (mode !== 'generate' && sourceKeys.length === 0) {
      const e: any = new Error('Source no longer available — please upload the image again.');
      e.friendly = 'Source no longer available — please upload the image again.';
      throw e;
    }
    const sources = await Promise.all(sourceKeys.map(async (k) => {
      try { return await getObject(k); }
      catch {
        const e: any = new Error('Source file no longer available — please upload the image again.');
        e.friendly = 'Source file no longer available — please upload the image again.';
        throw e;
      }
    }));

    const target = tasks.includes('format') && r.output_format
      ? resolveDimensions({ format: r.output_format, orientation: r.orientation, dpi })
      : null;

    const model = await pickModel(r.model_key);

    // The prompt + whether the model is needed at all, per mode.
    let prompt: string;
    let needsModel: boolean;
    if (mode === 'compose') { prompt = buildComposePrompt(description, cropMode === 'extend', sourceKeys.length); needsModel = true; }
    else if (mode === 'generate') { prompt = buildGeneratePrompt(description); needsModel = true; }
    else {
      prompt = buildPrompt({ tasks, cropMode, customInstruction: r.custom_instruction });
      needsModel = tasks.includes('clean') || wantCutout ||
        (tasks.includes('format') && cropMode === 'extend') || !!r.custom_instruction;
    }

    let working = sources[0] || Buffer.alloc(0);
    let modelUsed: string | null = null;
    let cost = 0;

    if (needsModel) {
      const inputUrls = sources.length ? await Promise.all(sources.map(toDataUrl)) : undefined;
      const gen = await generateImage({
        model: model.id,
        prompt,
        inputUrls,
        aspectRatio: target ? aspectRatio(target.w, target.h) : undefined,
        background: wantCutout ? 'transparent' : undefined,
        outputFormat: 'png',
      });
      working = gen.buffer;
      modelUsed = gen.model;
      cost = gen.cost;
    }
    if (!working.length) throw new Error('No image data produced');

    // Local post-processing: exactly onto the target size + dpi
    const fin = await finalizeToFormat(working, target, cropMode, dpi);
    let outBuf = fin.buffer;
    let hasAlpha = fin.hasAlpha || wantCutout;

    if (wantContour && r.contour_mm) {
      outBuf = await stickerContour(outBuf, Number(r.contour_mm), dpi);
      hasAlpha = true;
    }

    // Output format: the preset recipe's override, otherwise the global setting. JPG only without transparency.
    const gset = await one<{ output_ext: string | null }>('SELECT output_ext FROM settings WHERE id=1');
    const wantExt = (r.output_ext || gset?.output_ext || 'png').toLowerCase();
    let ext = 'png';
    let contentType = 'image/png';
    if (wantExt === 'jpg' && !hasAlpha) {
      outBuf = await sharp(outBuf, { failOn: 'none' })
        .flatten({ background: '#ffffff' })
        .withMetadata({ density: dpi })
        .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
      ext = 'jpg';
      contentType = 'image/jpeg';
    }

    // Write the AI provenance into the file in machine-readable form (IPTC DigitalSourceType).
    // "generate" is fully generated, everything else is an altered photo —
    // the IPTC list has a code of its own for that.
    outBuf = embedProvenance(outBuf, {
      sourceType: mode === 'generate' ? TRAINED_ALGORITHMIC_MEDIA : COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA,
      model: modelUsed,
      description: isPrivate ? null : prompt.slice(0, 300),
    });

    const key = resultKey(item.id);
    await putObject(key, outBuf, contentType);

    // Preview image (optional, per the setting)
    const cfg = await one<{ make_thumbnails: boolean; keep_sources: boolean; mirror_enabled: boolean }>(
      'SELECT make_thumbnails, keep_sources, mirror_enabled FROM settings WHERE id=1');
    let thumbPath: string | null = null;
    if (cfg?.make_thumbnails !== false) {
      try {
        const tk = thumbKey(item.id);
        await putObject(tk, await makeThumb(outBuf), 'image/webp');
        thumbPath = tk;
      } catch (e) { console.error('[process] thumbnail failed', e); }
    }

    // Unique per image: the second plus the item's short id in the name, plus a
    // cross-check in the database. Before this, two similar images from the same
    // day could get the same name and overwrite each other on the delivery target.
    const filename = await uniqueFilename(itemId, item.filename, formatToken(r.output_format), ext);
    const outputPx = `${fin.width}x${fin.height}`;
    // Private jobs: no delivery, no backup, no stored prompt.
    const deliveryStatus = (!isPrivate && (r.delivery === 'remote' || r.delivery === 'both')) ? 'pending' : 'none';
    const mirrorStatus = (!isPrivate && cfg?.mirror_enabled) ? 'pending' : 'none';

    await query(
      `UPDATE items SET status='done', result_path=$2, thumb_path=$3, filename=$4, output_px=$5, dpi=$6,
        has_alpha=$7, model_used=$8, prompt_used=$9, cost=$10, error_message=NULL,
        delivery_status=$11, mirror_status=$12 WHERE id=$1`,
      [itemId, key, thumbPath, filename, outputPx, dpi, hasAlpha, modelUsed,
       isPrivate ? null : prompt.slice(0, 1000), cost, deliveryStatus, mirrorStatus]);

    // Delete the source images unless they are kept — for private jobs always.
    if (isPrivate || cfg?.keep_sources === false) {
      for (const k of sourceKeys) await deleteObject(k).catch(() => {});
      if (isPrivate) await query(`UPDATE items SET source_path=NULL, source_paths=NULL WHERE id=$1`, [itemId]);
    }

    // A second copy on every backup target — not for private jobs.
    if (!isPrivate) {
      try {
        const { backupItem } = await import('./backup');
        await backupItem(itemId);
      } catch (e) { console.error('[process] backup failed', e); }
    }

    return { ok: true, cost };
  } catch (e: any) {
    const real = e?.message || String(e);
    const status = e?.status ? ` [status ${e.status}]` : '';
    console.error(`[process] item ${itemId} failed${status}: ${real}`, e?.stack || '');
    const msg = (e?.friendly ? `${e.friendly}` : real) + (e?.status ? ` (${e.status})` : '');
    await query(`UPDATE items SET status='failed', error_message=$2 WHERE id=$1`,
      [itemId, String(msg).slice(0, 500)]);
    if (e?.status === 402) throw e;
    return { ok: false, cost: 0, error: msg };
  }
}
