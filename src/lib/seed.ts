import { randomBytes } from 'node:crypto';
import { one, query } from './db';
import { hashPassword } from './auth';
import { has } from './modules';

/**
 * First start: create the administrator, the settings row, and a few example
 * presets. Idempotent — it runs on every boot and does nothing once the
 * instance has been set up.
 *
 * There are no built-in accounts. The very first boot creates exactly one
 * administrator, from `ADMIN_USERNAME` / `ADMIN_PASSWORD` if you set them, and
 * otherwise with a random password printed once to the server log. Nothing here
 * carries a name, a folder or a mailbox belonging to whoever built this.
 */
export async function seed(): Promise<void> {
  await query(`INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

  if (has('ai')) await seedModels();
  await seedAdmin();
  await seedPrintPresets();
  if (has('ai')) await seedRecipes();
}

/* ------------------------------------------------------------------ admin */

async function seedAdmin(): Promise<void> {
  const existing = await one<{ n: string }>(`SELECT count(*)::text AS n FROM users`);
  if (existing && Number(existing.n) > 0) return;

  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const given = process.env.ADMIN_PASSWORD;
  // 24 bytes of base64url is 32 characters — long enough that nobody is tempted
  // to leave it in place, short enough to copy out of a log by hand.
  const password = given || randomBytes(24).toString('base64url');

  await query(
    `INSERT INTO users (username, role, display_name, password_hash) VALUES ($1,'admin',$2,$3)`,
    [username, username, await hashPassword(password)],
  );

  if (given) {
    console.log(`[setup] Administrator "${username}" created with the password from ADMIN_PASSWORD.`);
  } else {
    // Printed once, on the first boot only. There is no way to recover it later;
    // the reset flow (module "mail") or a fresh volume is the way back.
    const lines = [
      'Klarbild is set up. Sign in with:',
      `  user      ${username}`,
      `  password  ${password}`,
      'Shown once. Change it under Account after you sign in.',
    ];
    const w = Math.max(...lines.map((l) => l.length)) + 2;
    console.log(
      '\n  ┌' + '─'.repeat(w) + '┐\n' +
        lines.map((l) => `  │ ${l.padEnd(w - 1)}│`).join('\n') +
        '\n  └' + '─'.repeat(w) + '┘\n',
    );
  }
}

/* ----------------------------------------------------------------- models */

async function seedModels(): Promise<void> {
  const count = await one<{ n: string }>(`SELECT count(*)::text AS n FROM models`);
  if (count && Number(count.n) === 0) {
    await query(`INSERT INTO models (model_id, label, description, active, is_default, supports_alpha, sort) VALUES
      ('google/gemini-3.1-flash-image','Fast','Ready in seconds. The everyday choice.',true,true,true,0),
      ('google/gemini-3-pro-image','Best quality','Slower, but truer to text and fine detail.',true,false,true,1),
      ('black-forest-labs/flux.2-flex','Open weights (FLUX.2)','Open model, good quality. Cannot cut out to transparency.',true,false,false,2)`);
  }
}

/* ---------------------------------------------------------------- recipes */

async function seedRecipes(): Promise<void> {
  const count = await one<{ n: string }>(`SELECT count(*)::text AS n FROM recipes`);
  if (!count || Number(count.n) > 0) return;

  const admin = await one<{ id: string }>(`SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`);
  const by = admin?.id ?? null;
  const R = (name: string, tasks: string[], fmt: string, orient: string, extra: Record<string, unknown> = {}) =>
    query(
      `INSERT INTO recipes (name, tasks, output_format, orientation, crop_mode, dpi, delivery, is_default, created_by, contour_mm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [name, JSON.stringify(tasks), fmt, orient, (extra.crop_mode as string) || 'crop', 300,
       (extra.delivery as string) || 'library', !!extra.is_default, by, (extra.contour_mm as number) ?? null]);

  await R('Clean up only', ['clean'], 'keep', 'landscape', { is_default: true });
  await R('Poster 30×40', ['clean', 'format'], '30x40', 'portrait');
  await R('TV frame (16:9)', ['clean', 'format'], 'tv169', 'landscape');
  await R('Sticker 5 cm', ['clean', 'cutout', 'format', 'contour'], 'sticker5', 'landscape', { contour_mm: 3 });
}

/* --------------------------------------------------------- print presets */

async function seedPrintPresets(): Promise<void> {
  const admin = await one<{ id: string }>(`SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`);
  const by = admin?.id ?? null;
  const P = async (name: string, config: Record<string, unknown>) => {
    const exists = await one(`SELECT id FROM print_presets WHERE name=$1`, [name]);
    if (exists) return;
    await query(`INSERT INTO print_presets (name, created_by, config) VALUES ($1,$2,$3)`,
      [name, by, JSON.stringify(config)]);
  };
  const sheet = {
    paperId: 'A4', paperCustom: '', paperLandscape: false, marginMm: 5,
    autoGap: true, gapMm: 14, bleedMm: 0,
    marks: 'corner', markLen: 4, markOff: 3, dpi: 300, ext: 'jpg', center: true, footer: true,
  };
  const F = (sizeId: string, count: number, landscape = false) =>
    ({ sizeId, customSize: '', landscape, count, allowRotate: true });

  // The classic school-photo set from a single portrait.
  await P('School photo set (A4)', { ...sheet, formats: [F('S13x18', 1), F('S9x13', 2), F('P35x45', 8)] });
  // Just the small prints, for when the large one is already done.
  await P('Small prints (A4)', { ...sheet, formats: [F('S9x13', 4), F('K30x40', 8)] });
  // A full sheet of passport photos — continuous lines, because every cell is identical.
  await P('Passport sheet 35×45 (A4)', { ...sheet, marks: 'grid', autoGap: false, gapMm: 4, formats: [F('P35x45', 20)] });
  // Two images at true size on one sheet of 10×15 photo paper.
  await P('2 × 10×7.5 on 10×15 photo paper', {
    ...sheet, paperId: 'F10x15', marginMm: 0, marks: 'grid', autoGap: false, gapMm: 0,
    formats: [{ sizeId: 'custom', customSize: '10x7,5', landscape: false, count: 2, allowRotate: true }],
  });
}
