#!/usr/bin/env node
// Klarbild MCP server — lets an AI assistant (e.g. Claude) hand local images, or
// images obtained some other way (iMessage, a given folder, …), over to Klarbild
// for processing. The assistant fetches the image files; this server uploads
// them and creates a job.
//
// Setup:
//   npm i @modelcontextprotocol/sdk
//   KLARBILD_URL=https://klarbild.example.com \
//   KLARBILD_TOKEN=klb_xxx node mcp/klarbild-mcp.mjs
// The token is generated in Klarbild under Admin → "Automation / MCP access".

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const BASE = (process.env.KLARBILD_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KLARBILD_TOKEN || '';
if (!BASE || !TOKEN) { console.error('KLARBILD_URL and KLARBILD_TOKEN must be set.'); process.exit(1); }

const authHeaders = { Authorization: `Bearer ${TOKEN}` };
const api = (path) => `${BASE}${path}`;

async function uploadFile(pathOrBase64, name) {
  let buf, filename = name;
  if (pathOrBase64.startsWith('data:')) {
    buf = Buffer.from(pathOrBase64.split(',')[1], 'base64');
    filename = name || 'image.png';
  } else {
    buf = await readFile(pathOrBase64);
    filename = name || basename(pathOrBase64);
  }
  const fd = new FormData();
  fd.append('files', new Blob([buf]), filename);
  const r = await fetch(api('/api/uploads'), { method: 'POST', headers: authHeaders, body: fd });
  const j = await r.json();
  const info = (j.files || [])[0];
  if (!info?.source_path) throw new Error(info?.error || 'Upload failed');
  return { source_path: info.source_path, filename };
}

const server = new Server({ name: 'klarbild', version: '1.0.0' }, { capabilities: { tools: {} } });

const TOOLS = [
  { name: 'list_recipes', description: 'List the presets/recipes available in Klarbild.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'process_images',
    description: 'Hand images to Klarbild and process them. Files as local paths OR data: URLs. Give either recipeId OR mode+options.',
    inputSchema: { type: 'object', properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'Local paths or data: URLs' },
      recipeId: { type: 'string', description: 'Optional: preset ID (from list_recipes) — overrides the individual options' },
      mode: { type: 'string', enum: ['each', 'compose', 'generate'], description: 'If no recipeId is given' },
      tasks: { type: 'array', items: { type: 'string', enum: ['clean', 'cutout', 'format', 'contour'] },
        description: 'Only for mode=each. Default: ["format"] if output_format is set.' },
      prompt_text: { type: 'string', description: 'Description for compose/generate' },
      output_format: { type: 'string', description: 'Fixed: 30x40, A4, theframe, portrait916, keep … OR custom: "25x35" (=25×35 cm) or "sticker5" (=5×5 cm).' },
      output_ext: { type: 'string', enum: ['png', 'jpg'], description: 'File format. Omit = global default setting. JPG only without transparency.' },
      orientation: { type: 'string', enum: ['portrait', 'landscape'] },
      crop_mode: { type: 'string', enum: ['crop', 'extend'] },
      contour_mm: { type: 'number', description: 'Sticker border in mm (only with tasks=cutout+contour).' },
      delivery_folder: { type: 'string', description: 'Target folder/subfolder on the delivery target (with delivery remote/both).' },
      delivery: { type: 'string', enum: ['library', 'remote', 'both'] },
    }, required: ['files'] } },
  { name: 'job_status', description: 'Query the status of a job (including finish time and error messages).',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] } },

  { name: 'exact_size',
    description: 'WITHOUT AI: bring an image to an exact physical size (centered crop at the target ratio, dpi metadata). Result is saved locally.',
    inputSchema: { type: 'object', properties: {
      file: { type: 'string', description: 'Local path or data: URL' },
      size: { type: 'string', description: 'Size: "12x15" (cm), "35x45mm", "5" (=5×5 cm) or "4:3/15"' },
      landscape: { type: 'boolean', description: 'Landscape instead of portrait' },
      dpi: { type: 'number', description: 'Default 300' },
      ext: { type: 'string', enum: ['jpg', 'png'] },
      out: { type: 'string', description: 'Target path for the file (default: ./klarbild-<size>.<ext>)' },
    }, required: ['file', 'size'] } },

  { name: 'print_sheet',
    description: 'WITHOUT AI: place several images at 100% size with crop marks onto a print sheet and save as a PDF. For sets of passport photos, daycare photos, stickers.',
    inputSchema: { type: 'object', properties: {
      images: { type: 'array', description: 'Per entry: file + final size + count',
        items: { type: 'object', properties: {
          file: { type: 'string', description: 'Local path or data: URL' },
          size: { type: 'string', description: 'Final size, e.g. "35x45mm", "9x13", "12x15"' },
          count: { type: 'number', description: 'How many times on the sheet (default 1)' },
          landscape: { type: 'boolean' },
          allowRotate: { type: 'boolean', description: 'May be placed rotated (default true)' },
        }, required: ['file', 'size'] } },
      paper: { type: 'string', description: 'A4 (default), A3, A3plus, A5, A6, A2, F10x15, F13x18, F9x13, F15x20, F20x30, Letter — or a custom size like "32.9x48.3"' },
      landscape: { type: 'boolean', description: 'Sheet landscape' },
      marks: { type: 'string', enum: ['none', 'corner', 'grid'], description: 'Cut guides (default corner)' },
      marginMm: { type: 'number', description: 'Margin to the paper edge, default 5' },
      gapMm: { type: 'number', description: 'Gap between the images, defaults to match the marks' },
      bleedMm: { type: 'number', description: 'Bleed per side, default 0' },
      dpi: { type: 'number', description: 'Default 300' },
      out: { type: 'string', description: 'Target path for the PDF (default: ./klarbild-sheet.pdf)' },
    }, required: ['images'] } },
];

server.setRequestHandler({ method: 'tools/list' }, async () => ({ tools: TOOLS }));

server.setRequestHandler({ method: 'tools/call' }, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    if (name === 'list_recipes') {
      const j = await (await fetch(api('/api/recipes'), { headers: authHeaders })).json();
      const list = (j.recipes || []).map((r) => `${r.id} — ${r.name} (${r.mode || 'each'})`).join('\n');
      return { content: [{ type: 'text', text: list || 'No presets.' }] };
    }
    if (name === 'process_images') {
      const files = a.files || [];
      const mode = a.mode || 'each';
      const sources = (mode === 'generate') ? [] : await Promise.all(files.map((f) => uploadFile(f)));
      const wantsFormat = a.output_format && a.output_format !== 'keep';
      const tasks = Array.isArray(a.tasks) && a.tasks.length ? a.tasks : (wantsFormat ? ['format'] : []);
      const body = a.recipeId
        ? { recipeId: a.recipeId, mode, sources, prompt_text: a.prompt_text }
        : { mode, prompt_text: a.prompt_text, sources,
            recipe: {
              tasks: mode === 'each' ? tasks : (wantsFormat ? ['format'] : []),
              output_format: a.output_format || 'keep',
              output_ext: a.output_ext || null,
              orientation: a.orientation || 'portrait',
              crop_mode: a.crop_mode || 'crop',
              contour_mm: a.contour_mm ?? null,
              delivery_folder: a.delivery_folder || null,
              delivery: a.delivery || 'library',
            },
            delivery: a.delivery || 'library' };
      const j = await (await fetch(api('/api/jobs'), { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (!j.jobId) throw new Error(j.error || 'Job failed');
      return { content: [{ type: 'text', text: `Job created: ${j.jobId}` }] };
    }
    if (name === 'exact_size') {
      const up = await uploadFile(a.file);
      const r = await fetch(api('/api/print/single'), {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: { kind: 'upload', path: up.source_path }, size: a.size,
          landscape: !!a.landscape, dpi: a.dpi || 300, ext: a.ext || 'jpg', name: up.filename }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const ext = a.ext === 'png' ? 'png' : 'jpg';
      const out = resolve(a.out || `./klarbild-${String(a.size).replace(/[^0-9a-z]+/gi, 'x')}.${ext}`);
      await writeFile(out, Buffer.from(await r.arrayBuffer()));
      const px = r.headers.get('x-klarbild-px'), real = r.headers.get('x-klarbild-real-dpi');
      const warn = r.headers.get('x-klarbild-dpi-ok') === '0' ? ` ⚠️ Source only supports about ${real} dpi.` : '';
      return { content: [{ type: 'text', text: `Saved: ${out} (${px} px).${warn}` }] };
    }
    if (name === 'print_sheet') {
      const imgs = a.images || [];
      if (!imgs.length) throw new Error('No images given.');
      const cells = [];
      for (const [i, im] of imgs.entries()) {
        const up = await uploadFile(im.file);
        cells.push({ id: `c${i}`, src: { kind: 'upload', path: up.source_path }, size: im.size,
          count: im.count || 1, landscape: !!im.landscape, allowRotate: im.allowRotate !== false });
      }
      const paper = a.paper && /[x×]/.test(a.paper) ? { size: a.paper } : { id: a.paper || 'A4' };
      const body = { paper, landscape: !!a.landscape, marginMm: a.marginMm ?? 5,
        bleedMm: a.bleedMm ?? 0, dpi: a.dpi || 300, ext: 'jpg', footer: true,
        marks: { mode: a.marks || 'corner' }, cells };
      if (a.gapMm != null) body.gapMm = a.gapMm;
      const r = await fetch(api('/api/print/sheet'), {
        method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const out = resolve(a.out || './klarbild-sheet.pdf');
      await writeFile(out, Buffer.from(await r.arrayBuffer()));
      return { content: [{ type: 'text', text:
        `Saved: ${out} — ${r.headers.get('x-klarbild-pages')} sheet(s), ${r.headers.get('x-klarbild-per-sheet')} images on sheet 1. ` +
        'When printing, choose "Actual size / 100%".' }] };
    }
    if (name === 'job_status') {
      const j = await (await fetch(api(`/api/jobs/${a.jobId}`), { headers: authHeaders })).json();
      const job = j.job || j;
      const errs = (j.items || []).map((it) => it.error_message).filter(Boolean);
      const fin = job.finished_at ? ` · finished ${job.finished_at}` : '';
      const errTxt = errs.length ? `\nErrors: ${errs.join('; ')}` : '';
      return { content: [{ type: 'text', text: `Status: ${job.status} — ${job.done_count}/${job.total} done${job.failed_count ? `, ${job.failed_count} failed` : ''}${fin}${errTxt}` }] };
    }
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e?.message || e}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error('[klarbild-mcp] ready');
