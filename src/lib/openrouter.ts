import { one } from './db';
import { decrypt } from './crypto';

const BASE = 'https://openrouter.ai/api/v1';

/** Key: the DB value (set in the admin area) takes precedence over the environment variable. */
export async function resolveKey(): Promise<string> {
  const row = await one<{ openrouter_key_enc: string | null }>(
    'SELECT openrouter_key_enc FROM settings WHERE id=1');
  if (row?.openrouter_key_enc) {
    try { return decrypt(row.openrouter_key_enc); } catch { /* falls back to ENV */ }
  }
  return process.env.OPENROUTER_API_KEY || '';
}

export class OpenRouterError extends Error {
  constructor(public status: number, public friendly: string, msg?: string) {
    super(msg || friendly);
  }
}

function friendlyFor(status: number): string {
  if (status === 402) return 'Credit used up — not possible right now.';
  if (status === 429) return 'Service overloaded — will be retried automatically.';
  if (status >= 500) return 'Service temporarily disrupted.';
  if (status === 401 || status === 403) return 'No access to the image service.';
  return 'Image processing failed.';
}

export interface GenerateOpts {
  model: string;
  prompt: string;
  inputUrl?: string;            // one reference image (data URL) — short form
  inputUrls?: string[];         // several reference images (compose) — up to 14/16 depending on the model
  aspectRatio?: string;         // "16:9", "3:4" …
  resolution?: string;          // "2K" | "4K" — NOT together with explicit pixels
  background?: 'transparent' | 'opaque';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  seed?: number;
}

export interface GenerateResult {
  buffer: Buffer;
  mediaType: string;
  cost: number;
  model: string;
}

/** The dedicated image endpoint POST /api/v1/images (not chat/completions). */
export async function generateImage(opts: GenerateOpts): Promise<GenerateResult> {
  const key = await resolveKey();
  if (!key) throw new OpenRouterError(401, friendlyFor(401), 'No OpenRouter key stored');

  const body: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    n: 1,
    output_format: opts.outputFormat || 'png',
  };
  const refs = opts.inputUrls?.length ? opts.inputUrls : (opts.inputUrl ? [opts.inputUrl] : []);
  if (refs.length) body.input_references = refs.map((url) => ({ type: 'image_url', image_url: { url } }));
  if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
  if (opts.resolution && !opts.aspectRatio) body.resolution = opts.resolution; // never both
  if (opts.background) body.background = opts.background;
  if (typeof opts.seed === 'number') body.seed = opts.seed;

  const res = await fetch(`${BASE}/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Klarbild',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new OpenRouterError(res.status, friendlyFor(res.status),
      `OpenRouter ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 300));
  }

  const json: any = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new OpenRouterError(502, 'No image received.', 'Response without b64_json');
  return {
    buffer: Buffer.from(b64, 'base64'),
    mediaType: json.data[0].media_type || 'image/png',
    cost: Number(json?.usage?.cost ?? 0),
    model: opts.model,
  };
}

/** The available image models (for the model list in the admin area). */
export async function listImageModels(): Promise<any[]> {
  const key = await resolveKey();
  const res = await fetch(`${BASE}/images/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new OpenRouterError(res.status, friendlyFor(res.status));
  return (await res.json())?.data ?? [];
}
