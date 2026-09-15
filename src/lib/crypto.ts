import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM. ENCRYPTION_KEY = 64 hex characters (32 bytes).
function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY || '';
  if (hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes) long');
  }
  return Buffer.from(hex, 'hex');
}

/** Encrypts plain text → "iv.tag.ciphertext" (base64url parts). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const [ivB, tagB, dataB] = payload.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Masks a key for display: sk-or-…4f2a */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  const tail = secret.slice(-4);
  const head = secret.slice(0, Math.min(5, secret.length));
  return `${head}…${tail}`;
}
