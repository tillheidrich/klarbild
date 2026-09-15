// Object storage abstraction. STORAGE_DRIVER=fs (volume, default) | s3 (MinIO/S3).
// Presigned URLs are not needed — originals go to the image API as a base64 data URL.
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DRIVER = (process.env.STORAGE_DRIVER || 'fs').toLowerCase();
const DIR = process.env.STORAGE_DIR || '/data';
const bucket = process.env.S3_BUCKET || 'klarbild';

// --- S3 (lazy, only when used) ----------------------------------------------
let _s3: any = null;
async function s3client() {
  if (!_s3) {
    const { S3Client } = await import('@aws-sdk/client-s3');
    _s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
    });
  }
  return _s3;
}

// --- API --------------------------------------------------------------------
export async function ensureBucket(): Promise<void> {
  if (DRIVER === 's3') {
    const { CreateBucketCommand, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const s3 = await s3client();
    try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }
    catch { await s3.send(new CreateBucketCommand({ Bucket: bucket })); }
  } else {
    await mkdir(DIR, { recursive: true });
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (DRIVER === 's3') {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3client()).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  } else {
    const p = join(DIR, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  if (DRIVER === 's3') {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await (await s3client()).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const c of res.Body as any) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }
  return readFile(join(DIR, key));
}

export async function deleteObject(key: string): Promise<void> {
  if (DRIVER === 's3') {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3client()).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } else {
    await unlink(join(DIR, key)).catch(() => {});
  }
}

/** Storage health check (directory writable, or bucket reachable). */
export async function storageOk(): Promise<boolean> {
  try {
    if (DRIVER === 's3') {
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      await (await s3client()).send(new HeadBucketCommand({ Bucket: bucket }));
    } else {
      await mkdir(DIR, { recursive: true });
      const probe = join(DIR, '.health');
      await writeFile(probe, 'ok'); await unlink(probe).catch(() => {});
    }
    return true;
  } catch { return false; }
}

export function sourceKey(uuid: string, ext: string): string {
  return `sources/${new Date().getFullYear()}/${uuid}.${ext}`;
}
export function resultKey(uuid: string): string {
  return `results/${new Date().getFullYear()}/${uuid}.png`;
}
export function thumbKey(uuid: string): string {
  return `thumbs/${new Date().getFullYear()}/${uuid}.webp`;
}
