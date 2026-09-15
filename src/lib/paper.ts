// Paper and image sizes for the print sheet (the "Print" module, no AI involved).
// All dimensions in millimetres — mm is the leading unit of this module, because a
// print sheet is a physical thing. Pixels only come into being at render time (mm → dpi).

export interface PaperSize { id: string; label: string; w: number; h: number; group: string }

/** Sheet sizes (portrait convention: short side × long side). */
export const PAPERS: PaperSize[] = [
  // DIN
  { id: 'A6',   label: 'DIN A6',  w: 105,   h: 148,   group: 'DIN' },
  { id: 'A5',   label: 'DIN A5',  w: 148,   h: 210,   group: 'DIN' },
  { id: 'A4',   label: 'DIN A4',  w: 210,   h: 297,   group: 'DIN' },
  { id: 'A3',   label: 'DIN A3',  w: 297,   h: 420,   group: 'DIN' },
  { id: 'A3plus', label: 'DIN A3+ (Super A3)', w: 329, h: 483, group: 'DIN' },
  { id: 'A2',   label: 'DIN A2',  w: 420,   h: 594,   group: 'DIN' },
  { id: 'A1',   label: 'DIN A1',  w: 594,   h: 841,   group: 'DIN' },
  // Photo paper (cut sheets, as sold over the counter)
  { id: 'F9x13',  label: 'Photo paper 9 × 13 cm',  w: 90,  h: 130, group: 'Photo paper' },
  { id: 'F10x15', label: 'Photo paper 10 × 15 cm', w: 100, h: 150, group: 'Photo paper' },
  { id: 'F13x18', label: 'Photo paper 13 × 18 cm', w: 130, h: 180, group: 'Photo paper' },
  { id: 'F15x20', label: 'Photo paper 15 × 20 cm', w: 150, h: 200, group: 'Photo paper' },
  { id: 'F20x30', label: 'Photo paper 20 × 30 cm', w: 200, h: 300, group: 'Photo paper' },
  { id: 'F10x10', label: 'Photo paper 10 × 10 cm', w: 100, h: 100, group: 'Photo paper' },
  { id: 'F13x13', label: 'Photo paper 13 × 13 cm', w: 130, h: 130, group: 'Photo paper' },
  { id: 'F4x6',   label: 'Photo paper 4 × 6 in (102 × 152 mm)', w: 101.6, h: 152.4, group: 'Photo paper' },
  { id: 'F5x7',   label: 'Photo paper 5 × 7 in (127 × 178 mm)', w: 127, h: 177.8, group: 'Photo paper' },
  { id: 'F8x10',  label: 'Photo paper 8 × 10 in (203 × 254 mm)', w: 203.2, h: 254, group: 'Photo paper' },
  // US
  { id: 'Letter', label: 'US Letter', w: 215.9, h: 279.4, group: 'US' },
  { id: 'Legal',  label: 'US Legal',  w: 215.9, h: 355.6, group: 'US' },
];

/** Image sizes (the trim size of a single image on the sheet). */
export interface PhotoSize { id: string; label: string; w: number; h: number; group: string }

export const PHOTO_SIZES: PhotoSize[] = [
  // --- Passport / ID photo (national requirements) ---
  { id: 'P35x45', label: 'Passport photo 35 × 45 mm (DE/EU, biometric)', w: 35, h: 45, group: 'Passport photo' },
  { id: 'P33x48', label: 'China visa 33 × 48 mm',                        w: 33, h: 48, group: 'Passport photo' },
  { id: 'P50x50', label: 'US visa 51 × 51 mm (2 × 2 in)',                w: 50.8, h: 50.8, group: 'Passport photo' },
  { id: 'P50x70', label: 'Canada passport photo 50 × 70 mm',             w: 50, h: 70, group: 'Passport photo' },
  { id: 'P45x35', label: 'Passport photo landscape 45 × 35 mm',          w: 45, h: 35, group: 'Passport photo' },
  { id: 'P25x35', label: 'Small ID 25 × 35 mm',                          w: 25, h: 35, group: 'Passport photo' },

  // --- Small sizes (nursery, school, wallet) ---
  { id: 'K20x30', label: '2 × 3 cm',   w: 20, h: 30, group: 'Small' },
  { id: 'K30x40', label: '3 × 4 cm',   w: 30, h: 40, group: 'Small' },
  { id: 'K35x50', label: '3.5 × 5 cm', w: 35, h: 50, group: 'Small' },
  { id: 'K40x50', label: '4 × 5 cm',   w: 40, h: 50, group: 'Small' },
  { id: 'K45x60', label: '4.5 × 6 cm', w: 45, h: 60, group: 'Small' },
  { id: 'K50x70', label: '5 × 7 cm',   w: 50, h: 70, group: 'Small' },
  { id: 'K60x80', label: '6 × 8 cm',   w: 60, h: 80, group: 'Small' },
  { id: 'K60x90', label: '6 × 9 cm',   w: 60, h: 90, group: 'Small' },
  { id: 'K70x100', label: '7 × 10 cm', w: 70, h: 100, group: 'Small' },

  // --- Classic photo sizes ---
  { id: 'S9x13',  label: '9 × 13 cm',   w: 90,  h: 130, group: 'Photo' },
  { id: 'S10x15', label: '10 × 15 cm',  w: 100, h: 150, group: 'Photo' },
  { id: 'S11x15', label: '11 × 15 cm',  w: 110, h: 150, group: 'Photo' },
  { id: 'S12x15', label: '12 × 15 cm',  w: 120, h: 150, group: 'Photo' },
  { id: 'S13x18', label: '13 × 18 cm',  w: 130, h: 180, group: 'Photo' },
  { id: 'S15x20', label: '15 × 20 cm',  w: 150, h: 200, group: 'Photo' },
  { id: 'S15x21', label: '15 × 21 cm',  w: 150, h: 210, group: 'Photo' },
  { id: 'S18x24', label: '18 × 24 cm',  w: 180, h: 240, group: 'Photo' },
  { id: 'S20x25', label: '20 × 25 cm',  w: 200, h: 250, group: 'Photo' },
  { id: 'S20x30', label: '20 × 30 cm',  w: 200, h: 300, group: 'Photo' },
  { id: 'S24x30', label: '24 × 30 cm',  w: 240, h: 300, group: 'Photo' },
  { id: 'S28x35', label: '28 × 35 cm',  w: 280, h: 350, group: 'Photo' },

  // --- Inch sizes (US photo labs, frames bought abroad) ---
  { id: 'Z2_5x3_5', label: 'Wallet 2.5 × 3.5 in (64 × 89 mm)', w: 63.5, h: 88.9, group: 'Inches (US)' },
  { id: 'Z3_5x5',   label: '3.5 × 5 in (89 × 127 mm)',         w: 88.9, h: 127, group: 'Inches (US)' },
  { id: 'Z4x6',     label: '4 × 6 in (102 × 152 mm)',          w: 101.6, h: 152.4, group: 'Inches (US)' },
  { id: 'Z5x7',     label: '5 × 7 in (127 × 178 mm)',          w: 127, h: 177.8, group: 'Inches (US)' },
  { id: 'Z8x10',    label: '8 × 10 in (203 × 254 mm)',         w: 203.2, h: 254, group: 'Inches (US)' },
  { id: 'Z11x14',   label: '11 × 14 in (279 × 356 mm)',        w: 279.4, h: 355.6, group: 'Inches (US)' },
  { id: 'Z16x20',   label: '16 × 20 in (406 × 508 mm)',        w: 406.4, h: 508, group: 'Inches (US)' },
  { id: 'Z24x36',   label: '24 × 36 in (610 × 914 mm)',        w: 609.6, h: 914.4, group: 'Inches (US)' },

  // --- Instant-film look-alikes (image area, not card size) ---
  { id: 'I46x62', label: 'Instax mini · image area 46 × 62 mm', w: 46, h: 62, group: 'Instant photo' },
  { id: 'I62x62', label: 'Instax Square · image area 62 × 62 mm', w: 62, h: 62, group: 'Instant photo' },
  { id: 'I99x62', label: 'Instax Wide · image area 99 × 62 mm', w: 99, h: 62, group: 'Instant photo' },
  { id: 'I79x79', label: 'Polaroid · image area 79 × 79 mm',     w: 79, h: 79, group: 'Instant photo' },
  { id: 'I88x107', label: 'Polaroid · whole card 88 × 107 mm',  w: 88, h: 107, group: 'Instant photo' },

  // --- Poster and frame sizes ---
  { id: 'R30x40', label: '30 × 40 cm',  w: 300, h: 400, group: 'Poster & frames' },
  { id: 'R30x45', label: '30 × 45 cm',  w: 300, h: 450, group: 'Poster & frames' },
  { id: 'R40x50', label: '40 × 50 cm',  w: 400, h: 500, group: 'Poster & frames' },
  { id: 'R40x60', label: '40 × 60 cm',  w: 400, h: 600, group: 'Poster & frames' },
  { id: 'R45x60', label: '45 × 60 cm',  w: 450, h: 600, group: 'Poster & frames' },
  { id: 'R50x70', label: '50 × 70 cm',  w: 500, h: 700, group: 'Poster & frames' },
  { id: 'R60x80', label: '60 × 80 cm',  w: 600, h: 800, group: 'Poster & frames' },
  { id: 'R60x90', label: '60 × 90 cm',  w: 600, h: 900, group: 'Poster & frames' },
  { id: 'R70x100', label: '70 × 100 cm', w: 700, h: 1000, group: 'Poster & frames' },
  { id: 'R80x120', label: '80 × 120 cm', w: 800, h: 1200, group: 'Poster & frames' },
  { id: 'R100x140', label: '100 × 140 cm', w: 1000, h: 1400, group: 'Poster & frames' },

  // --- Squares ---
  { id: 'Q10x10', label: '10 × 10 cm', w: 100, h: 100, group: 'Square' },
  { id: 'Q13x13', label: '13 × 13 cm', w: 130, h: 130, group: 'Square' },
  { id: 'Q15x15', label: '15 × 15 cm', w: 150, h: 150, group: 'Square' },
  { id: 'Q20x20', label: '20 × 20 cm', w: 200, h: 200, group: 'Square' },
  { id: 'Q25x25', label: '25 × 25 cm', w: 250, h: 250, group: 'Square' },
  { id: 'Q30x30', label: '30 × 30 cm', w: 300, h: 300, group: 'Square' },
  { id: 'Q40x40', label: '40 × 40 cm', w: 400, h: 400, group: 'Square' },
  { id: 'Q50x50', label: '50 × 50 cm', w: 500, h: 500, group: 'Square' },
  { id: 'Q70x70', label: '70 × 70 cm', w: 700, h: 700, group: 'Square' },

  // --- DIN ---
  { id: 'DA7', label: 'DIN A7 (7.4 × 10.5 cm)',  w: 74,  h: 105, group: 'DIN' },
  { id: 'DA6', label: 'DIN A6 (10.5 × 14.8 cm)', w: 105, h: 148, group: 'DIN' },
  { id: 'DA5', label: 'DIN A5 (14.8 × 21 cm)',   w: 148, h: 210, group: 'DIN' },
  { id: 'DA4', label: 'DIN A4 (21 × 29.7 cm)',   w: 210, h: 297, group: 'DIN' },
  { id: 'DA3', label: 'DIN A3 (29.7 × 42 cm)',   w: 297, h: 420, group: 'DIN' },
  { id: 'DA3P', label: 'DIN A3+ (32.9 × 48.3 cm)', w: 329, h: 483, group: 'DIN' },
  { id: 'DA2', label: 'DIN A2 (42 × 59.4 cm)',   w: 420, h: 594, group: 'DIN' },
  { id: 'DA1', label: 'DIN A1 (59.4 × 84.1 cm)', w: 594, h: 841, group: 'DIN' },
  { id: 'DA0', label: 'DIN A0 (84.1 × 118.9 cm)', w: 841, h: 1189, group: 'DIN' },

  // --- Cards and printed matter ---
  { id: 'C85x55',  label: 'Business card 85 × 55 mm',        w: 85, h: 55, group: 'Cards' },
  { id: 'C148x105', label: 'Postcard 14.8 × 10.5 cm (A6 landscape)', w: 148, h: 105, group: 'Cards' },
  { id: 'C99x210', label: 'DL 9.9 × 21 cm',                 w: 99, h: 210, group: 'Cards' },
  { id: 'C210x99', label: 'DL landscape 21 × 9.9 cm',        w: 210, h: 99, group: 'Cards' },
  { id: 'C54x86',  label: 'Credit card 85.6 × 54 mm',        w: 85.6, h: 54, group: 'Cards' },
  { id: 'C70x100', label: 'Bookmark 7 × 21 cm',             w: 70, h: 210, group: 'Cards' },

  // --- Aspect ratios as a print size (worked out on 30 cm) ---
  { id: 'W16x9', label: '16:9 "The Frame" (30 cm wide)', w: 300, h: 168.75, group: 'Aspect ratio' },
  { id: 'W9x16', label: '9:16 portrait (30 cm tall)',      w: 168.75, h: 300, group: 'Aspect ratio' },
  { id: 'W21x9', label: '21:9 cinema (30 cm wide)',        w: 300, h: 128.57, group: 'Aspect ratio' },
  { id: 'W2x1',  label: '2:1 panorama (30 cm wide)',       w: 300, h: 150, group: 'Aspect ratio' },
  { id: 'W3x2',  label: '3:2 (30 cm wide)',                w: 300, h: 200, group: 'Aspect ratio' },
  { id: 'W2x3',  label: '2:3 (30 cm tall)',                w: 200, h: 300, group: 'Aspect ratio' },
  { id: 'W4x3',  label: '4:3 (30 cm wide)',                w: 300, h: 225, group: 'Aspect ratio' },
  { id: 'W3x4',  label: '3:4 (30 cm tall)',                w: 225, h: 300, group: 'Aspect ratio' },
  { id: 'W5x4',  label: '5:4 (30 cm wide)',                w: 300, h: 240, group: 'Aspect ratio' },
  { id: 'W4x5',  label: '4:5 Instagram (30 cm tall)',      w: 240, h: 300, group: 'Aspect ratio' },
  { id: 'W1x1',  label: '1:1 square (30 cm)',              w: 300, h: 300, group: 'Aspect ratio' },
];

export const paperById = (id: string) => PAPERS.find((p) => p.id === id) || null;
export const photoById = (id: string) => PHOTO_SIZES.find((p) => p.id === id) || null;

/**
 * Free-text size → mm. Deliberately generous, because people type sizes the way they say them:
 *   "12x15"      → 120 × 150 mm (cm is the default unit)
 *   "12 × 15 cm" → 120 × 150 mm
 *   "35x45mm"    → 35 × 45 mm
 *   "5"          → 50 × 50 mm (square)
 *   "4:3 / 15"   → aspect ratio 4:3, longer side 15 cm → 150 × 112.5 mm
 */
export function parseSizeMm(input: string): { w: number; h: number } | null {
  const t = (input || '').trim().toLowerCase().replace(/,/g, '.');
  if (!t) return null;

  // Aspect ratio with a target edge: "4:3 / 15" or "4:3 15cm"
  const ratio = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*(?:[/@ ]\s*(\d+(?:\.\d+)?)\s*(mm|cm)?)?$/.exec(t);
  if (ratio && ratio[3]) {
    // a:b is read as width:height — so "3:4/15" is portrait, "4:3/15" landscape.
    const a = parseFloat(ratio[1]), b = parseFloat(ratio[2]);
    const long = ratio[4] === 'mm' ? parseFloat(ratio[3]) : parseFloat(ratio[3]) * 10;
    if (!a || !b || !long) return null;
    return a >= b ? norm(long, long * (b / a)) : norm(long * (a / b), long);
  }

  const unit = /mm\s*$/.test(t) ? 1 : 10;                 // no unit given: cm
  const body = t.replace(/\s*(mm|cm)\s*$/, '').trim();

  const wh = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/.exec(body);
  if (wh) return norm(parseFloat(wh[1]) * unit, parseFloat(wh[2]) * unit);

  const sq = /^(\d+(?:\.\d+)?)$/.exec(body);
  if (sq) { const n = parseFloat(sq[1]) * unit; return norm(n, n); }

  return null;
}

function norm(w: number, h: number): { w: number; h: number } | null {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (!(w > 0) || !(h > 0) || w > 2000 || h > 2000) return null;
  return { w: r(w), h: r(h) };
}

export const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);
export const mmToPt = (mm: number) => (mm / 25.4) * 72;

/** Readable caption for a size — without losing the real decimal places. */
export function labelMm(w: number, h: number): string {
  const mm = (n: number) => dec(Math.round(n * 10) / 10);
  const cm = (n: number) => dec(Math.round(n * 100) / 1000);
  return w < 100 && h < 100 ? `${mm(w)} × ${mm(h)} mm` : `${cm(w)} × ${cm(h)} cm`;
}
// Decimal separator of the caption. A point, i.e. English notation. The output
// of `labelMm` is assembled at run time out of numbers, so it cannot go through
// the dictionary — whatever is written here is what every instance shows, and an
// English instance must not print "11,25 × 15 cm". `tests/printlayout.test.ts`
// pins the spelling.
const dec = (n: number) => String(n);
