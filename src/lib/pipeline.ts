import sharp from 'sharp';
import type { Dimensions } from './format';

export type CropMode = 'crop' | 'extend';

/**
 * Brings a (model) result exactly onto the target size and writes dpi metadata.
 * target=null → keep the original (only set the dpi). Keeps alpha if there is any.
 */
export async function finalizeToFormat(
  buffer: Buffer,
  target: Dimensions | null,
  cropMode: CropMode,
  dpi: number,
): Promise<{ buffer: Buffer; width: number; height: number; hasAlpha: boolean }> {
  let img = sharp(buffer, { failOn: 'none' });
  const meta = await img.metadata();
  const hasAlpha = !!meta.hasAlpha;

  if (target) {
    img = sharp(buffer, { failOn: 'none' }).resize(target.w, target.h, {
      fit: 'cover',
      position: cropMode === 'crop' ? sharp.strategy.attention : 'centre',
    });
  }

  const out = await img
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  return { buffer: out.data, width: out.info.width, height: out.info.height, hasAlpha };
}

/**
 * A white sticker border around the cut-out subject (without the model).
 * Extract the alpha → dilation (blur+threshold) → white contour layer → the original on top.
 * Radius = contourMm / 25.4 * dpi.
 */
export async function stickerContour(
  buffer: Buffer,
  contourMm: number,
  dpi: number,
): Promise<Buffer> {
  const base = sharp(buffer, { failOn: 'none' }).ensureAlpha();
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error('Image dimensions unknown');

  const radiusPx = Math.max(1, Math.round((contourMm / 25.4) * dpi));

  // The alpha as a greyscale mask, widened by blur+threshold (dilation).
  const mask = await sharp(buffer, { failOn: 'none' })
    .ensureAlpha()
    .extractChannel('alpha')
    .blur(Math.max(0.3, radiusPx / 2))
    .threshold(1)
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  // A white layer with the widened mask as its alpha.
  const whiteLayer = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .joinChannel(mask, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  // Lay the original (RGBA) over the contour layer.
  const original = await base.png().toBuffer();
  return sharp(whiteLayer)
    .composite([{ input: original }])
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** HEIC/HEIF → PNG buffer (in a standard build sharp usually cannot read HEIC). */
export async function heicToPng(buffer: Buffer): Promise<Buffer> {
  const convert = (await import('heic-convert')).default as any;
  const out = await convert({ buffer, format: 'PNG' });
  return Buffer.from(out);
}

