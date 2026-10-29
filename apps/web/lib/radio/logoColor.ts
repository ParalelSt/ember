/** A station tile's colour (the owner's "Station colour" pick): the colour
 *  of the station's own logo, read from its pixels, or a steady colour of
 *  its own when it has no logo or the logo has no colour to give. */

export type Rgb = readonly [number, number, number];

/** What a logo's pixels say: its main colour, or, for a logo drawn only in
 *  white or only in black, which of the two (so the tile can sit behind it
 *  without hiding it). null when nothing in it shows (all see-through). */
export type LogoColor = { kind: 'color'; rgb: Rgb } | { kind: 'light' } | { kind: 'dark' } | null;

/** Below this alpha a pixel counts as see-through. */
const MIN_ALPHA = 128;
/** A pixel with every channel above this is near white. */
const NEAR_WHITE = 230;
/** A pixel with every channel below this is near black. */
const NEAR_BLACK = 35;
/** Of the shown pixels, how many must be coloured for the logo to have a
 *  colour (a few stray ones in a black and white logo do not count). */
const MIN_COLOURED_SHARE = 0.06;

/** The logo's main colour from its RGBA pixels (a canvas' ImageData): the
 *  most common colour among the shown pixels that are neither near white
 *  nor near black, as the average of the pixels of that colour. */
export function logoColor(pixels: ArrayLike<number>): LogoColor {
  // 3 bits a channel: 512 buckets, coarse enough that a logo's anti-aliased
  // edges fall in with its main colour.
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  let shown = 0;
  let light = 0;
  let dark = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < MIN_ALPHA) continue;
    shown += 1;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE) { light += 1; continue; }
    if (r < NEAR_BLACK && g < NEAR_BLACK && b < NEAR_BLACK) { dark += 1; continue; }
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = counts.get(key);
    if (bucket) { bucket.n += 1; bucket.r += r; bucket.g += g; bucket.b += b; }
    else counts.set(key, { n: 1, r, g, b });
  }
  if (shown === 0) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  let coloured = 0;
  for (const bucket of counts.values()) {
    coloured += bucket.n;
    if (!best || bucket.n > best.n) best = bucket;
  }
  if (best && coloured / shown >= MIN_COLOURED_SHARE) {
    return { kind: 'color', rgb: [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] };
  }
  return dark > light ? { kind: 'dark' } : { kind: 'light' };
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The lightest a tile gets: a pale logo colour is darkened to about this,
 *  so a white logo part and the heart on it still show. */
export const MAX_TILE_LUMINANCE = 0.45;

/** A logo colour as the tile's background, a very light one darkened a
 *  little (its hue kept). */
export function tileColor(rgb: Rgb): string {
  const l = luminance(rgb);
  let out: Rgb = rgb;
  if (l > MAX_TILE_LUMINANCE) {
    // Luminance grows about as the channels to the power 2.2.
    const k = (MAX_TILE_LUMINANCE / l) ** (1 / 2.2);
    out = [Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)];
  }
  return `rgb(${out[0]} ${out[1]} ${out[2]})`;
}

/** The tile behind a logo drawn only in black: a pale warm grey. */
export const DARK_LOGO_TILE = 'hsl(30 12% 86%)';

/** A steady colour of the station's own, from its id: a muted hue, dark
 *  enough for white initials. */
export function fallbackTileColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 30% 34%)`;
}

/** The tile's background for what the logo said (null: no logo, or it
 *  could not be read). */
export function stationTileColor(id: string, color: LogoColor): string {
  if (color?.kind === 'color') return tileColor(color.rgb);
  if (color?.kind === 'dark') return DARK_LOGO_TILE;
  return fallbackTileColor(id);
}

/** Up to two initials for a tile with no logo: "Radio Sljeme" is "RS",
 *  "Otvoreni" is "O". Empty when the name has no letters or digits. */
export function stationInitials(name: string): string {
  const words = name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
