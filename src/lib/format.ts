// Target sizes & exact pixel calculation (see 01 §5, 06 §3).
// px = round(cm / 2.54 * dpi)

export type Orientation = 'portrait' | 'landscape';

export interface Dimensions { w: number; h: number; cm?: [number, number]; label: string; }

// cm sizes: [width, height] in the portrait convention (short side × long side)
const CM: Record<string, [number, number]> = {
  '9x13': [9, 13], '10x15': [10, 15], '13x18': [13, 18], '15x20': [15, 20],
  '20x30': [20, 30], '30x40': [30, 40], '30x45': [30, 45], '40x50': [40, 50],
  '40x60': [40, 60], '50x70': [50, 70], '60x90': [60, 90],
  A4: [21, 29.7], A3: [29.7, 42], A2: [42, 59.4],
  '20x20': [20, 20], '30x30': [30, 30],
};

// Pure screen sizes (fixed pixels, no cm/dpi)
const SCREEN: Record<string, [number, number]> = {
  theframe: [3840, 2160],   // 16:9 landscape
  portrait916: [2160, 3840], // 9:16 portrait
};

export const cmToPx = (cm: number, dpi: number) => Math.round((cm / 2.54) * dpi);

export interface ResolveInput {
  format: string;             // a key from above, 'sticker', 'custom' or 'keep'
  orientation?: Orientation;
  dpi?: number;
  customCm?: [number, number]; // for 'sticker'/'custom'
}

/** Returns exact target pixels + label. `keep` → null (keep the original). */
export function resolveDimensions(input: ResolveInput): Dimensions | null {
  const { format } = input;
  const dpi = input.dpi ?? 300;
  const orient = input.orientation ?? 'portrait';

  if (format === 'keep') return null;

  if (format in SCREEN) {
    const [w, h] = SCREEN[format];
    return { w, h, label: format === 'theframe' ? 'The Frame' : 'Portrait' };
  }

  let cm: [number, number] | undefined;
  if (format in CM) cm = CM[format];
  else if (format === 'sticker' || format === 'custom') cm = input.customCm ?? [5, 5];
  else {
    // Read freely defined sizes straight out of the key — no database migration needed:
    //  "sticker5" / "sticker-7,5" → square N×N cm; "25x35" / "25×35" → W×H cm.
    const sq = /^sticker[-_ ]?(\d+(?:[.,]\d+)?)$/i.exec(format);
    const wh = /^(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)$/i.exec(format);
    const num = (s: string) => parseFloat(s.replace(',', '.'));
    if (sq) { const n = num(sq[1]); cm = [n, n]; }
    else if (wh) cm = [num(wh[1]), num(wh[2])];
  }
  if (!cm || !cm[0] || !cm[1] || cm[0] > 300 || cm[1] > 300)
    throw new Error(`Unknown format: ${format}`);

  // Portrait convention → apply the requested orientation
  let [wCm, hCm] = cm;
  if (orient === 'landscape') [wCm, hCm] = [hCm, wCm];
  return { w: cmToPx(wCm, dpi), h: cmToPx(hCm, dpi), cm: [wCm, hCm],
           label: `${cm[0]}×${cm[1]} cm` };
}

/** Simplified aspect ratio as "w:h" for the image API. */
export function aspectRatio(w: number, h: number): string {
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/** Is the native resolution enough for real 300 dpi? (A hint in the UI.) */
export function upscaleWarning(srcW: number, srcH: number, target: Dimensions): boolean {
  return srcW < target.w * 0.95 || srcH < target.h * 0.95;
}
