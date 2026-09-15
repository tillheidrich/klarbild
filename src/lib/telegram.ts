// Telegram bot (grammY, webhook) — a full input and control channel.
// Pairing, bundling of forwarded images, preset recipe choice, processing, feedback.
import { Bot, InputFile, InlineKeyboard, Keyboard } from 'grammy';
import { randomUUID } from 'node:crypto';
import { one, query } from './db';
import { decrypt } from './crypto';
import { getObject, putObject, sourceKey } from './storage';
import { enqueue } from './queue';
import { layout, cutMarks, recommendedGap, type SheetSpec } from './printlayout';
import { renderCell, buildSheetPdf } from './printrender';
import { photoById, labelMm, paperById } from './paper';

const QUIET_MS = 4000;               // quiet window for the bundling
const BASE = process.env.PUBLIC_BASE_URL || '';

let bot: Bot | null = null;
let webhookSecret = '';
// Scratch space: free text the user can turn into an image with one button.
const pendingGenerate = new Map<number, string>();
// Chats that are typing an image description right now (after tapping “New image”).
const awaitingGenerate = new Set<number>();

// Menu labels (persistent keyboard) — everything by fingertip, without commands.
const BTN_NEW = '✨ New image', BTN_RECIPES = '📁 Choose recipe', BTN_HELP = '❓ Help';
function mainKeyboard() {
  return new Keyboard().text(BTN_NEW).row().text(BTN_RECIPES).text(BTN_HELP).resized().persistent();
}
// Print sheet via Telegram: a fixed, tappable choice — no free text needed.
const PRINT_SIZES = ['P35x45', 'K30x40', 'S9x13', 'S10x15', 'S13x18', 'R30x40'];
const PRINT_COUNTS = [1, 2, 4, 8, 0];   // 0 = “fill the sheet”

const HELP_TEXT =
  'How it works — all by button, without commands:\n\n' +
  '🖼 *Edit:* send the image or images here (best as a *file*), then tap the preset recipe at the bottom.\n' +
  '🔀 *Combine:* send 2+ images, put a description such as “with our dog” in the image caption field — then tap “🔀 Combine”.\n' +
  '✨ *New image:* tap “✨ New image” at the bottom and describe what should come out.\n' +
  '♻️ *Keep editing:* simply send a finished image from me back to me.\n' +
  '🖨 *Print (without AI):* send an image → “🖨 Print” → tap the size and the quantity. ' +
  'You get a PDF at 100 % size with crop marks.\n\n' +
  'I report back once, when everything is done — with the result and a link.';

export async function getToken(): Promise<string> {
  const s = await one<{ telegram_bot_token_enc: string | null }>('SELECT telegram_bot_token_enc FROM settings WHERE id=1');
  if (s?.telegram_bot_token_enc) { try { return decrypt(s.telegram_bot_token_enc); } catch { /* ENV */ } }
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

export async function getBot(): Promise<Bot | null> {
  if (bot) return bot;
  const token = await getToken();
  if (!token) return null;
  bot = new Bot(token);
  register(bot);
  await bot.init();
  return bot;
}

export function getWebhookSecret(): string { return webhookSecret; }

/** At startup: register the webhook (secret from settings) + the bundling sweeper. */
export async function setupTelegram(): Promise<void> {
  const b = await getBot();
  if (!b) { console.log('[telegram] no token — bot inactive'); return; }
  const s = await one<{ telegram_webhook_secret: string | null }>('SELECT telegram_webhook_secret FROM settings WHERE id=1');
  webhookSecret = s?.telegram_webhook_secret || randomUUID().replace(/-/g, '');
  if (!s?.telegram_webhook_secret) await query('UPDATE settings SET telegram_webhook_secret=$1 WHERE id=1', [webhookSecret]);
  if (BASE) {
    try {
      await b.api.setWebhook(`${BASE}/api/telegram/webhook`, {
        secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
      });
      console.log('[telegram] webhook set:', `${BASE}/api/telegram/webhook`);
    } catch (e) { console.error('[telegram] setWebhook failed:', e); }
  }
  // Command menu (the “/” menu in Telegram) — as an additional shortcut.
  try {
    await b.api.setMyCommands([
      { command: 'new', description: '✨ Generate a new image from text' },
      { command: 'presets', description: '📁 Choose the default preset recipe' },
      { command: 'status', description: '⏳ Show the last job' },
      { command: 'help', description: '❓ Help & guide' },
      { command: 'start', description: '🏠 Show the menu' },
    ]);
  } catch (e) { console.error('[telegram] setMyCommands:', e); }
  setInterval(() => { sweepDrafts().catch((e) => console.error('[telegram] sweep', e)); }, 3000);
}

// --- Pairing ----------------------------------------------------------------
async function linkedUser(chatId: number) {
  return one<{ user_id: string; default_recipe_id: string | null }>(
    'SELECT user_id, default_recipe_id FROM telegram_links WHERE chat_id=$1 AND active', [chatId]);
}

async function tryPair(chatId: number, code: string): Promise<boolean> {
  const row = await one<{ user_id: string }>(
    `SELECT user_id FROM telegram_pairing_codes WHERE code=$1 AND used_at IS NULL AND expires_at > now()`, [code.trim()]);
  if (!row) return false;
  await query(`UPDATE telegram_pairing_codes SET used_at=now() WHERE code=$1`, [code.trim()]);
  await query(`INSERT INTO telegram_links (chat_id, user_id, active) VALUES ($1,$2,true)
               ON CONFLICT (chat_id) DO UPDATE SET user_id=$2, active=true`, [chatId, row.user_id]);
  return true;
}

// --- Bundling (drafts) ------------------------------------------------------
async function addToDraft(chatId: number, mediaGroup: string | null, fileRef: any, caption?: string | null) {
  const existing = await one<{ id: string; file_refs: any[]; caption: string | null }>(
    `SELECT id, file_refs, caption FROM telegram_drafts WHERE chat_id=$1 AND status='collecting'
     ORDER BY last_received_at DESC LIMIT 1`, [chatId]);
  if (existing) {
    const refs = [...(existing.file_refs || []), fileRef];
    // Keep the first caption that came in as the description.
    const cap = existing.caption || (caption?.trim() || null);
    await query(`UPDATE telegram_drafts SET file_refs=$2, caption=$3, last_received_at=now() WHERE id=$1`,
      [existing.id, JSON.stringify(refs), cap]);
    return existing.id;
  }
  const row = await one<{ id: string }>(
    `INSERT INTO telegram_drafts (chat_id, media_group_id, file_refs, caption, status)
     VALUES ($1,$2,$3,$4,'collecting') RETURNING id`,
    [chatId, mediaGroup, JSON.stringify([fileRef]), caption?.trim() || null]);
  return row!.id;
}

/** Sweeper: drafts that finished collecting (quiet window over) → ask for the preset recipe. */
export async function sweepDrafts(): Promise<void> {
  const b = await getBot(); if (!b) return;
  const drafts = await query<any>(
    `SELECT id, chat_id, file_refs, caption FROM telegram_drafts
     WHERE status='collecting' AND last_received_at < now() - interval '${Math.round(QUIET_MS / 1000)} seconds'`);
  for (const d of drafts) {
    const recipes = await query<any>('SELECT id, name FROM recipes ORDER BY is_default DESC, name LIMIT 6');
    const kb = new InlineKeyboard();
    // Callback data <64 bytes: only the recipe UUID; the draft is found via the chat on click.
    recipes.forEach((r, i) => { kb.text(r.name, `r:${r.id}`); if (i % 2 === 1) kb.row(); });
    const n = (d.file_refs || []).length;
    // From 2 images on, additionally offer “Combine”.
    if (n >= 2) { kb.row(); kb.text('🔀 Combine into one image', 'c:x'); }
    kb.row(); kb.text('🖨 Print (without AI)', 'p:menu');
    const compressed = (d.file_refs || []).some((f: any) => f.quality === 'compressed');
    const capNote = d.caption ? `\n📝 Description recognised: “${d.caption}” — for “Combine”.` : '';
    try {
      await b.api.sendMessage(d.chat_id,
        `${n} image${n > 1 ? 's' : ''} received. What would you like to do?` + capNote +
        (compressed ? '\n⚠️ Sent as a photo (compressed). For full quality send as a *file*.' : ''),
        { reply_markup: kb, parse_mode: 'Markdown' });
      await query(`UPDATE telegram_drafts SET status='awaiting_recipe' WHERE id=$1`, [d.id]);
    } catch (e) { console.error('[telegram] sweep send:', e); }
  }
}

// --- Draft -> job -----------------------------------------------------------

/** Loads all images of a draft from Telegram and puts them into the object store. */
async function refsToSources(refs: any[], b: Bot): Promise<any[]> {
  const sources: any[] = [];
  const token = await getToken();
  for (const ref of refs || []) {
    try {
      const file = await b.api.getFile(ref.file_id);
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const key = sourceKey(randomUUID(), 'jpg');
      await putObject(key, buf, 'image/jpeg');
      sources.push({ source_path: key, filename: ref.name || 'telegram.jpg', quality: ref.quality || 'original' });
    } catch (e) { console.error('[telegram] loading the file failed', e); }
  }
  return sources;
}

/** Base snapshot from the chat's default preset recipe (format/model/delivery). */
async function chatRecipeDefaults(chatId: number): Promise<any> {
  const link = await linkedUser(chatId);
  if (link?.default_recipe_id) {
    const r = await one<any>('SELECT * FROM recipes WHERE id=$1', [link.default_recipe_id]);
    if (r) return {
      output_format: r.output_format, orientation: r.orientation, crop_mode: r.crop_mode || 'crop',
      dpi: r.dpi || 300, model_key: r.model_key, delivery: r.delivery || 'library',
      delivery_folder: r.delivery_folder, output_ext: r.output_ext, delivery_target_id: r.delivery_target_id,
    };
  }
  return { output_format: 'keep', crop_mode: 'crop', dpi: 300, delivery: 'library', output_ext: null };
}

async function dispatchDraft(chatId: number, draftId: string, recipeId: string, b: Bot) {
  const draft = await one<any>('SELECT * FROM telegram_drafts WHERE id=$1', [draftId]);
  if (!draft || draft.status === 'dispatched') return;
  const recipe = await one<any>('SELECT * FROM recipes WHERE id=$1', [recipeId]);
  if (!recipe) { await b.api.sendMessage(chatId, 'Preset recipe not found.'); return; }
  const link = await linkedUser(chatId);

  await b.api.sendMessage(chatId, `⏳ Processing ${(draft.file_refs || []).length} image(s) …`);
  const sources = await refsToSources(draft.file_refs || [], b);
  if (!sources.length) { await b.api.sendMessage(chatId, '❌ No images could be loaded.'); return; }

  const snap = {
    tasks: recipe.tasks, output_format: recipe.output_format, orientation: recipe.orientation,
    crop_mode: recipe.crop_mode || 'crop', dpi: recipe.dpi || 300, contour_mm: recipe.contour_mm,
    model_key: recipe.model_key, custom_instruction: recipe.custom_instruction,
    delivery: recipe.delivery || 'library', delivery_folder: recipe.delivery_folder,
    output_ext: recipe.output_ext, delivery_target_id: recipe.delivery_target_id,
  };
  const job = await one<{ id: string }>(
    `INSERT INTO jobs (created_by, origin, mode, recipe_snapshot, status, total, telegram_chat_id)
     VALUES ($1,'telegram','each',$2,'queued',$3,$4) RETURNING id`,
    [link?.user_id || null, JSON.stringify(snap), sources.length, chatId]);
  for (let i = 0; i < sources.length; i++) {
    const it = await one<{ id: string }>(
      `INSERT INTO items (job_id, position, status, source_path, filename, source_quality)
       VALUES ($1,$2,'queued',$3,$4,$5) RETURNING id`,
      [job!.id, i, sources[i].source_path, sources[i].filename, sources[i].quality]);
    await enqueue({ itemId: it!.id, jobId: job!.id });
  }
  await query(`UPDATE telegram_drafts SET status='dispatched' WHERE id=$1`, [draftId]);
}

/** Combine: all images of the draft + the description → one new image. */
async function dispatchCompose(chatId: number, draftId: string, description: string, b: Bot) {
  const draft = await one<any>('SELECT * FROM telegram_drafts WHERE id=$1', [draftId]);
  if (!draft || draft.status === 'dispatched') return;
  const link = await linkedUser(chatId);
  await b.api.sendMessage(chatId, '⏳ Combining the images …');
  const sources = await refsToSources(draft.file_refs || [], b);
  if (sources.length < 2) { await b.api.sendMessage(chatId, '❌ To combine I need at least 2 images.'); return; }

  const d = await chatRecipeDefaults(chatId);
  const wantsFormat = d.output_format && d.output_format !== 'keep';
  const snap = {
    tasks: wantsFormat ? ['format'] : [], output_format: d.output_format, orientation: d.orientation,
    crop_mode: d.crop_mode || 'crop', dpi: d.dpi || 300, model_key: d.model_key,
    prompt_text: description, delivery: d.delivery || 'library', delivery_folder: d.delivery_folder,
    output_ext: d.output_ext, delivery_target_id: d.delivery_target_id,
  };
  const job = await one<{ id: string }>(
    `INSERT INTO jobs (created_by, origin, mode, recipe_snapshot, status, total, telegram_chat_id)
     VALUES ($1,'telegram','compose',$2,'queued',1,$3) RETURNING id`,
    [link?.user_id || null, JSON.stringify(snap), chatId]);
  const it = await one<{ id: string }>(
    `INSERT INTO items (job_id, position, status, source_paths, filename, source_quality)
     VALUES ($1,0,'queued',$2,'combined','original') RETURNING id`,
    [job!.id, JSON.stringify(sources.map((s) => s.source_path))]);
  await enqueue({ itemId: it!.id, jobId: job!.id });
  await query(`UPDATE telegram_drafts SET status='dispatched' WHERE id=$1`, [draftId]);
}

/** Free text: a completely new image from the description alone. */
async function dispatchGenerate(chatId: number, description: string, b: Bot) {
  const link = await linkedUser(chatId);
  await b.api.sendMessage(chatId, '⏳ Generating a new image …');
  const d = await chatRecipeDefaults(chatId);
  const wantsFormat = d.output_format && d.output_format !== 'keep';
  const snap = {
    tasks: wantsFormat ? ['format'] : [], output_format: d.output_format, orientation: d.orientation,
    crop_mode: d.crop_mode || 'crop', dpi: d.dpi || 300, model_key: d.model_key,
    prompt_text: description, delivery: d.delivery || 'library', delivery_folder: d.delivery_folder,
    output_ext: d.output_ext, delivery_target_id: d.delivery_target_id,
  };
  const job = await one<{ id: string }>(
    `INSERT INTO jobs (created_by, origin, mode, recipe_snapshot, status, total, telegram_chat_id)
     VALUES ($1,'telegram','generate',$2,'queued',1,$3) RETURNING id`,
    [link?.user_id || null, JSON.stringify(snap), chatId]);
  const it = await one<{ id: string }>(
    `INSERT INTO items (job_id, position, status, filename, source_quality)
     VALUES ($1,0,'queued','new','original') RETURNING id`, [job!.id]);
  await enqueue({ itemId: it!.id, jobId: job!.id });
}

/**
 * Print sheet without AI: bring the draft's images to a size, place them on A4,
 * add crop marks, send it back as a PDF. Runs directly (no queue, no model,
 * no cost).
 */
async function dispatchPrint(chatId: number, draftId: string, sizeId: string, count: number, b: Bot) {
  const draft = await one<any>('SELECT * FROM telegram_drafts WHERE id=$1', [draftId]);
  if (!draft) { await b.api.sendMessage(chatId, 'No open image batch found.'); return; }
  const size = photoById(sizeId);
  if (!size) { await b.api.sendMessage(chatId, 'Unknown size.'); return; }

  await b.api.sendMessage(chatId, '📐 Building the print sheet …');
  const sources = await refsToSources(draft.file_refs || [], b);
  if (!sources.length) { await b.api.sendMessage(chatId, '❌ No images could be loaded.'); return; }

  const a4 = paperById('A4')!;
  const sheet: SheetSpec = {
    wMm: a4.w, hMm: a4.h, marginMm: 5,
    gapMm: recommendedGap('corner', 0, 4, 3), bleedMm: 0, center: true,
  };
  // “Fill the sheet”: as often as possible, spread evenly over the images.
  let per = count;
  if (!per) {
    const probe = layout([{ id: 'x', wMm: size.w, hMm: size.h, count: 200, allowRotate: true }], sheet);
    per = Math.max(1, Math.floor((probe.pages[0]?.placements.length || 1) / sources.length));
  }
  const specs = sources.map((s, i) => ({ id: `s${i}`, wMm: size.w, hMm: size.h, count: per, allowRotate: true }));
  const plan = layout(specs, sheet);
  if (!plan.pages.length) { await b.api.sendMessage(chatId, '❌ The size does not fit on A4.'); return; }

  const images: Record<string, { bytes: Buffer; ext: 'jpg' | 'png' }> = {};
  for (const [i, src] of sources.entries()) {
    const buf = await getObject(src.source_path);
    const rots = new Set(plan.pages.flatMap((pg) => pg.placements.filter((p) => p.specId === `s${i}`).map((p) => p.rotated)));
    for (const rot of rots) {
      const out = await renderCell(buf, null, size.w, size.h, 300, { ext: 'jpg', rotate: rot });
      images[rot ? `s${i}::rot` : `s${i}`] = { bytes: out.buffer, ext: out.ext };
    }
  }
  const pages = plan.pages.map((pg) => ({
    placements: pg.placements.map((p) => ({ ...p, specId: p.rotated ? `${p.specId}::rot` : p.specId })),
  }));
  const marks = plan.pages.map((pg) => cutMarks(pg, sheet, { mode: 'corner', lengthMm: 4, offsetMm: 3 }));
  const label = labelMm(size.w, size.h);
  const bytes = await buildSheetPdf({
    sheet, pages, marksPerPage: marks, images, title: `Klarbild print sheet ${label}`,
    footer: {
      text: `Klarbild · DIN A4 · ${label} · 300 dpi · print at 100 % (not “fit to page”)`,
      position: 'bottom-left', sizePt: 6,
    },
  });

  const file = new InputFile(Buffer.from(bytes), `klarbild-print-sheet-${label.replace(/[^0-9]+/g, 'x')}.pdf`);
  await b.api.sendDocument(chatId, file, {
    caption: `📐 ${plan.pages.length} sheet(s) · ${plan.pages[0].placements.length} image(s) on sheet 1 · ${label}\n` +
             'When printing choose “Actual size / 100 %” — otherwise the size is wrong.',
  });
  await query(`UPDATE telegram_drafts SET status='dispatched' WHERE id=$1`, [draftId]);
}

/** Called by the worker: one message back to the chat when the job is done. */
export async function notifyJobDone(chatId: number, jobId: string): Promise<void> {
  const b = await getBot(); if (!b) return;
  const items = await query<any>(
    `SELECT id, filename, result_path, status, delivery_status FROM items WHERE job_id=$1 ORDER BY position`, [jobId]);
  const done = items.filter((i) => i.status === 'done');
  const failed = items.filter((i) => i.status === 'failed');
  const delivered = items.filter((i) => i.delivery_status === 'delivered').length;

  // Send the results back as files (as long as the number is manageable)
  if (done.length <= 10) {
    for (const it of done) {
      try {
        const buf = await getObject(it.result_path);
        await b.api.sendDocument(chatId, new InputFile(buf, it.filename || 'klarbild.png'));
      } catch (e) { console.error('[telegram] sending', e); }
    }
  }
  let msg = `✅ Done: ${done.length} image(s)${failed.length ? `, ${failed.length} failed` : ''}.`;
  if (delivered) msg += `\n📁 ${delivered} delivered to the folder on the target.`;
  if (BASE) msg += `\n🔗 Library: ${BASE}/library`;
  if (done.length) msg += `\n♻️ Keep editing? Just send a result back.`;
  await b.api.sendMessage(chatId, msg, { reply_markup: mainKeyboard() });
}

// --- Handler ----------------------------------------------------------------
function register(b: Bot) {
  const sendRecipeMenu = async (ctx: any) => {
    const recipes = await query<any>('SELECT id, name FROM recipes ORDER BY is_default DESC, name LIMIT 10');
    const kb = new InlineKeyboard();
    recipes.forEach((r, i) => { kb.text(r.name, `d:${r.id}`); if (i % 2 === 1) kb.row(); });
    return ctx.reply('Which preset recipe should apply to new images by default?', { reply_markup: kb });
  };

  b.command('start', async (ctx) => {
    const link = await linkedUser(ctx.chat.id);
    if (link) return ctx.reply('👋 Klarbild is connected. Send me images to edit/combine, or tap “✨ New image” at the bottom.', { reply_markup: mainKeyboard() });
    return ctx.reply('👋 Welcome to Klarbild. To pair, enter the *pairing code* from the admin area here.', { parse_mode: 'Markdown' });
  });

  const sendHelp = (ctx: any) => ctx.reply(HELP_TEXT, { parse_mode: 'Markdown', reply_markup: mainKeyboard() });
  b.command('help', sendHelp);

  b.command('new', async (ctx) => {
    if (!(await linkedUser(ctx.chat.id))) return ctx.reply('Please pair first (code from the admin area).');
    const text = (ctx.match || '').toString().trim();
    if (!text) { awaitingGenerate.add(ctx.chat.id); return ctx.reply('Describe your image briefly — what should come out?'); }
    const b2 = await getBot(); if (b2) await dispatchGenerate(ctx.chat.id, text, b2);
  });

  b.command('presets', async (ctx) => {
    if (!(await linkedUser(ctx.chat.id))) return ctx.reply('Please pair first (code from the admin area).');
    return sendRecipeMenu(ctx);
  });

  b.command('status', async (ctx) => {
    if (!(await linkedUser(ctx.chat.id))) return ctx.reply('Please pair first.');
    const j = await one<any>(`SELECT status, done_count, failed_count, total FROM jobs
      WHERE telegram_chat_id=$1 ORDER BY created_at DESC LIMIT 1`, [ctx.chat.id]);
    if (!j) return ctx.reply('No jobs yet.');
    return ctx.reply(`Last job: ${j.status} — ${j.done_count}/${j.total} done${j.failed_count ? `, ${j.failed_count} failed` : ''}.`);
  });

  const onImage = async (ctx: any, fileId: string, name: string, quality: 'original' | 'compressed') => {
    if (!(await linkedUser(ctx.chat.id))) return ctx.reply('⛔️ Not paired. Please enter the pairing code from the admin area.');
    await addToDraft(ctx.chat.id, ctx.message?.media_group_id || null,
      { file_id: fileId, name, quality }, ctx.message?.caption || null);
  };
  b.on('message:photo', async (ctx) => {
    const p = ctx.message.photo[ctx.message.photo.length - 1];
    await onImage(ctx, p.file_id, 'photo.jpg', 'compressed');
  });
  b.on('message:document', async (ctx) => {
    const d = ctx.message.document;
    if (!(d.mime_type || '').startsWith('image/')) return;
    await onImage(ctx, d.file_id, d.file_name || 'image', 'original');
  });

  b.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const text = ctx.message.text.trim();
    const linked = await linkedUser(ctx.chat.id);
    if (linked) {
      // Buttons of the persistent keyboard
      if (text === BTN_HELP) return sendHelp(ctx);
      if (text === BTN_RECIPES) return sendRecipeMenu(ctx);
      if (text === BTN_NEW) { awaitingGenerate.add(ctx.chat.id); return ctx.reply('Describe your image briefly — what should come out?'); }

      // Is a combine draft waiting for the description? → take the text as the description.
      const waiting = await one<{ id: string }>(
        `SELECT id FROM telegram_drafts WHERE chat_id=$1 AND status='awaiting_compose_text'
         ORDER BY last_received_at DESC LIMIT 1`, [ctx.chat.id]);
      if (waiting) {
        const b2 = await getBot(); if (b2) await dispatchCompose(ctx.chat.id, waiting.id, text, b2);
        return;
      }
      // The user tapped “New image” and is typing the description now.
      if (awaitingGenerate.has(ctx.chat.id)) {
        awaitingGenerate.delete(ctx.chat.id);
        const b2 = await getBot(); if (b2) await dispatchGenerate(ctx.chat.id, text, b2);
        return;
      }
      // Otherwise: offer the free text as something to generate an image from.
      const kb = new InlineKeyboard().text('✨ Yes, generate an image from it', 'g:x');
      pendingGenerate.set(ctx.chat.id, text);
      return ctx.reply('Should I generate a new image from that?', { reply_markup: kb });
    }
    if (await tryPair(ctx.chat.id, text)) {
      return ctx.reply('✅ Connected. Send me images or tap “✨ New image” at the bottom.', { reply_markup: mainKeyboard() });
    }
    return ctx.reply('Code invalid or expired. Generate a new code in the admin area.');
  });

  b.on('callback_query:data', async (ctx) => {
    const [kind, recipeId, extra] = ctx.callbackQuery.data.split(':');
    await ctx.answerCallbackQuery();
    // Buttons need an active pairing too — otherwise an old chat keeps working.
    if (!(await linkedUser(ctx.chat!.id))) return ctx.editMessageText('⛔️ Not (any longer) paired. Please enter a new pairing code from the admin area.');
    if (kind === 'p') {   // Print sheet without AI
      const draft = await one<{ id: string }>(
        `SELECT id FROM telegram_drafts WHERE chat_id=$1 AND status IN ('awaiting_recipe','awaiting_print')
         ORDER BY last_received_at DESC LIMIT 1`, [ctx.chat!.id]);
      if (!draft) return ctx.editMessageText('No open image batch found — please send the images again.');
      if (recipeId === 'menu') {
        await query(`UPDATE telegram_drafts SET status='awaiting_print' WHERE id=$1`, [draft.id]);
        const kb = new InlineKeyboard();
        PRINT_SIZES.forEach((id, i) => {
          const s = photoById(id); if (!s) return;
          kb.text(labelMm(s.w, s.h), `p:${id}`); if (i % 2 === 1) kb.row();
        });
        return ctx.editMessageText('📐 What final size should the image have?', { reply_markup: kb });
      }
      if (extra === undefined) {
        const s = photoById(recipeId);
        if (!s) return ctx.editMessageText('Unknown size.');
        const kb = new InlineKeyboard();
        PRINT_COUNTS.forEach((n, i) => {
          kb.text(n ? `${n}×` : 'Fill the sheet', `p:${recipeId}:${n}`); if (i % 2 === 1) kb.row();
        });
        return ctx.editMessageText(`📐 ${labelMm(s.w, s.h)} — how many times on the A4 sheet?`, { reply_markup: kb });
      }
      await ctx.editMessageText('Got it — the sheet is being built.');
      const b2 = await getBot();
      if (b2) await dispatchPrint(ctx.chat!.id, draft.id, recipeId, Number(extra) || 0, b2)
        .catch((e) => b2.api.sendMessage(ctx.chat!.id, `❌ Print sheet failed: ${e?.message || e}`));
      return;
    }
    if (kind === 'd') { // Set the default preset recipe
      await query(`UPDATE telegram_links SET default_recipe_id=$2 WHERE chat_id=$1`, [ctx.chat!.id, recipeId]);
      return ctx.editMessageText('Default preset recipe set.');
    }
    if (kind === 'r') { // Preset recipe chosen → process this chat's open draft
      const draft = await one<{ id: string }>(
        `SELECT id FROM telegram_drafts WHERE chat_id=$1 AND status='awaiting_recipe'
         ORDER BY last_received_at DESC LIMIT 1`, [ctx.chat!.id]);
      if (!draft) return ctx.editMessageText('No open image batch found — please send the images again.');
      await ctx.editMessageText('Got it, here we go.');
      const b2 = await getBot(); if (b2) await dispatchDraft(ctx.chat!.id, draft.id, recipeId, b2);
    }
    if (kind === 'c') { // Combine chosen
      const draft = await one<{ id: string; caption: string | null }>(
        `SELECT id, caption FROM telegram_drafts WHERE chat_id=$1 AND status='awaiting_recipe'
         ORDER BY last_received_at DESC LIMIT 1`, [ctx.chat!.id]);
      if (!draft) return ctx.editMessageText('No open image batch found — please send the images again.');
      if (draft.caption?.trim()) {
        await ctx.editMessageText(`Got it — combining with: “${draft.caption.trim()}”.`);
        const b2 = await getBot(); if (b2) await dispatchCompose(ctx.chat!.id, draft.id, draft.caption.trim(), b2);
      } else {
        await query(`UPDATE telegram_drafts SET status='awaiting_compose_text' WHERE id=$1`, [draft.id]);
        await ctx.editMessageText('Describe briefly what should come out (for example “the image, but with our dog”):');
      }
    }
    if (kind === 'g') { // Free text → new image
      const text = pendingGenerate.get(ctx.chat!.id);
      if (!text) return ctx.editMessageText('Text no longer available — please send it again or use /new.');
      pendingGenerate.delete(ctx.chat!.id);
      await ctx.editMessageText('Got it, generating a new image …');
      const b2 = await getBot(); if (b2) await dispatchGenerate(ctx.chat!.id, text, b2);
    }
  });
}
