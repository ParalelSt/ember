/** OKLCH colour maths for themes. Plain TS, no dependencies: sRGB <-> OKLab with Björn
 *  Ottosson's matrices, a chroma-reducing gamut map for hex output, and the
 *  WCAG 2.x contrast ratio. */

/** Lightness 0..1, chroma 0..0.4, hue 0..360 degrees. */
export type Oklch = readonly [l: number, c: number, h: number];

type Rgb = [number, number, number];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function linearRgbToOklch([r, g, b]: Rgb): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

/** Linear sRGB for an OKLCH colour, NOT clamped: a channel outside 0..1
 *  means the colour is out of the sRGB gamut. */
export function oklchToLinearRgb([L, C, H]: Oklch): Rgb {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const EPS = 1e-6;
const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -EPS && c <= 1 + EPS);

const clip = (rgb: Rgb) => rgb.map((c) => clamp(c, 0, 1)) as Rgb;

/** OKLab distance between two OKLCH colours, the second given as linear
 *  sRGB (so a clipped colour can be measured against its original). */
function deltaE(a: Oklch, rgb: Rgb): number {
  const b = linearRgbToOklch(rgb);
  const ab = (c: Oklch) => [c[0], c[1] * Math.cos((c[2] * Math.PI) / 180), c[1] * Math.sin((c[2] * Math.PI) / 180)];
  const [x1, y1, z1] = ab(a);
  const [x2, y2, z2] = ab(b);
  return Math.hypot(x1! - x2!, y1! - y2!, z1! - z2!);
}

/** A "just noticeable difference" in OKLab (CSS Color 4 gamut mapping). */
const JND = 0.02;

/** The colour pulled into sRGB the way CSS Color 4 (and so a browser)
 *  does: a colour whose plain clip is within a just-noticeable difference
 *  is clipped, anything further has its chroma lowered (binary search, 16
 *  steps) with lightness and hue kept. Returns clamped linear sRGB. */
function toGamutLinear(color: Oklch): Rgb {
  const [L, C, H] = [clamp(color[0], 0, 1), Math.max(0, color[1]), color[2]];
  const rgb = oklchToLinearRgb([L, C, H]);
  if (inGamut(rgb)) return clip(rgb);
  if (L >= 1) return [1, 1, 1];
  if (L <= 0) return [0, 0, 0];
  if (deltaE([L, C, H], clip(rgb)) < JND) return clip(rgb);
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const current: Oklch = [L, mid, H];
    const at = oklchToLinearRgb(current);
    if (inGamut(at) || deltaE(current, clip(at)) < JND) lo = mid;
    else hi = mid;
  }
  return clip(oklchToLinearRgb([L, lo, H]));
}

/** Gamma-encoded sRGB channels 0..1, gamut-mapped. */
export function oklchToSrgb(color: Oklch): Rgb {
  return toGamutLinear(color).map(linearToSrgb) as Rgb;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(text: string): boolean {
  return HEX.test(text.trim());
}

/** `#rrggbb` (or `#rgb`, with or without the #) to OKLCH, full precision.
 *  Throws on anything else; check with `isHex` first. */
export function hexToOklch(hex: string): Oklch {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const digits = m[1]!.length === 3 ? [...m[1]!].map((d) => d + d).join('') : m[1]!;
  const rgb = [0, 2, 4].map((i) => srgbToLinear(parseInt(digits.slice(i, i + 2), 16) / 255)) as Rgb;
  return linearRgbToOklch(rgb);
}

/** OKLCH to `#rrggbb`, gamut-mapped by chroma. */
export function oklchToHex(color: Oklch): string {
  return (
    '#' +
    oklchToSrgb(color)
      .map((c) => Math.round(c * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Storage precision: L and C to 4 decimals, H to 2, enough that a hex a
 *  person typed comes back as the same hex (within 1 per channel). A
 *  chroma under 0.0005 is a grey, stored as C 0 and H 0. */
export function roundOklch([l, c, h]: Oklch): Oklch {
  const L = round(clamp(l, 0, 1), 4);
  const C = round(Math.max(0, c), 4);
  if (C < 0.0005) return [L, 0, 0];
  return [L, C, round(((h % 360) + 360) % 360, 2) % 360];
}

/** The CSS string, `oklch(0.16 0.005 260)` or `oklch(1 0 0 / 8%)`. */
export function formatOklch(color: Oklch, alphaPct?: number): string {
  const [l, c, h] = roundOklch(color);
  return alphaPct == null ? `oklch(${l} ${c} ${h})` : `oklch(${l} ${c} ${h} / ${alphaPct}%)`;
}

export interface ParsedOklch {
  color: Oklch;
  /** Percent, 0..100; absent for an opaque colour. */
  alphaPct?: number;
}

const OKLCH_CSS =
  /^oklch\(\s*(-?[\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/i;

/** Reads what `formatOklch` writes (and the `:root` values in globals.css).
 *  Null for anything else. */
export function parseOklch(css: string): ParsedOklch | null {
  const m = OKLCH_CSS.exec(css.trim());
  if (!m) return null;
  const l = Number(m[1]) / (m[2] ? 100 : 1);
  const color: Oklch = [l, Number(m[3]), Number(m[4])];
  if (color.some((n) => !Number.isFinite(n))) return null;
  if (m[5] == null) return { color };
  const alpha = Number(m[5]);
  return { color, alphaPct: m[6] ? alpha : alpha * 100 };
}

function luminanceOfSrgb([r, g, b]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio, 1..21. With `alphaOverB` (0..1), `a` is
 *  translucent and composited over `b` first, the way a browser paints it. */
export function contrast(a: Oklch, b: Oklch, alphaOverB?: number): number {
  const bRgb = oklchToSrgb(b);
  let aRgb = oklchToSrgb(a);
  if (alphaOverB != null) {
    const t = clamp(alphaOverB, 0, 1);
    aRgb = aRgb.map((c, i) => c * t + bRgb[i]! * (1 - t)) as Rgb;
  }
  const la = luminanceOfSrgb(aRgb);
  const lb = luminanceOfSrgb(bRgb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
