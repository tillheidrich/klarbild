import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { one, query } from '../../../lib/db';
import { encrypt, maskSecret, decrypt } from '../../../lib/crypto';
import { loadMailSource } from '../../../lib/mail';

export const prerender = false;
const randomToken = () => 'klb_' + randomBytes(24).toString('hex');
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async () => {
  const s = await one<any>('SELECT * FROM settings WHERE id=1');
  const mail = await loadMailSource();
  if (!s) return json({ settings: null });
  let orMask = '';
  if (s.openrouter_key_enc) { try { orMask = maskSecret(decrypt(s.openrouter_key_enc)); } catch { orMask = 'set'; } }
  return json({ settings: {
    openrouter_key_masked: orMask, openrouter_key_set: !!s.openrouter_key_enc,
    delivery_host: s.delivery_host, delivery_protocol: s.delivery_protocol, delivery_port: s.delivery_port,
    delivery_user: s.delivery_user, delivery_base_path: s.delivery_base_path,
    delivery_default_folder: s.delivery_default_folder,
    delivery_password_set: !!s.delivery_password_enc,
    default_dpi: s.default_dpi, default_crop_mode: s.default_crop_mode, concurrency: s.concurrency,
    cricut_sheet_cm: s.cricut_sheet_cm, monthly_budget: s.monthly_budget, n8n_webhook_url: s.n8n_webhook_url,
    // Storage housekeeping
    keep_sources: s.keep_sources, make_thumbnails: s.make_thumbnails, retention_days: s.retention_days,
    metadata_sidecar: s.metadata_sidecar, api_token: s.api_token,
    delivery_metadata_sidecar: s.delivery_metadata_sidecar, mirror_metadata_sidecar: s.mirror_metadata_sidecar,
    output_ext: s.output_ext,
    // Permissions / privacy / NSFW
    library_visibility: s.library_visibility, anonymous_generations: s.anonymous_generations,
    private_allowed: s.private_allowed, allow_nsfw: s.allow_nsfw,
    // Backup mirror
    mirror_enabled: s.mirror_enabled, mirror_host: s.mirror_host, mirror_protocol: s.mirror_protocol, mirror_port: s.mirror_port,
    mirror_user: s.mirror_user, mirror_base_path: s.mirror_base_path, mirror_password_set: !!s.mirror_password_enc,
    // Outgoing mail (the password is never returned, only whether it is set)
    smtp_host: s.smtp_host, smtp_port: s.smtp_port, smtp_secure: s.smtp_secure,
    smtp_user: s.smtp_user, smtp_from: s.smtp_from, smtp_password_set: !!s.smtp_password,
    // Where the credentials in effect come from: 'database' | 'environment' | null
    smtp_source: mail?.source ?? null,
    smtp_effective: mail ? { host: mail.cfg.host, port: mail.cfg.port, user: mail.cfg.user, from: mail.cfg.from } : null,
    // Sharing
    share_default_days: s.share_default_days,
  } });
};

export const PATCH: APIRoute = async ({ request }) => {
  const b = await request.json();
  const sets: string[] = []; const args: any[] = [];
  const set = (col: string, val: any) => { args.push(val); sets.push(`${col}=$${args.length}`); };

  if (b.openrouter_key) set('openrouter_key_enc', encrypt(String(b.openrouter_key)));
  if (b.delivery_password) set('delivery_password_enc', encrypt(String(b.delivery_password)));
  if (b.mirror_password) set('mirror_password_enc', encrypt(String(b.mirror_password)));
  if (b.smtp_password) set('smtp_password', encrypt(String(b.smtp_password)));
  if (b.generate_api_token) set('api_token', randomToken());
  const boolCols = ['keep_sources', 'make_thumbnails', 'mirror_enabled', 'metadata_sidecar',
    'delivery_metadata_sidecar', 'mirror_metadata_sidecar', 'anonymous_generations', 'private_allowed', 'allow_nsfw',
    'smtp_secure'];
  for (const col of ['delivery_host', 'delivery_protocol', 'delivery_port', 'delivery_user', 'delivery_base_path',
    'delivery_default_folder', 'default_dpi', 'default_crop_mode', 'concurrency', 'cricut_sheet_cm', 'monthly_budget', 'n8n_webhook_url',
    'keep_sources', 'make_thumbnails', 'retention_days', 'metadata_sidecar', 'api_token',
    'delivery_metadata_sidecar', 'mirror_metadata_sidecar', 'output_ext',
    'library_visibility', 'anonymous_generations', 'private_allowed', 'allow_nsfw',
    'mirror_enabled', 'mirror_host', 'mirror_protocol', 'mirror_port', 'mirror_user', 'mirror_base_path',
    'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'share_default_days']) {
    if (col in b) {
      const raw = b[col];
      const val = boolCols.includes(col) ? !!raw : (raw === '' ? null : raw);
      set(col, val);
    }
  }
  if (!sets.length) return json({ ok: true });
  await query(`UPDATE settings SET ${sets.join(',')} WHERE id=1`, args);
  return json({ ok: true });
};
