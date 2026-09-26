/** The equalizer: five bands, the same on every engine.
 *
 *  A low shelf at 60 Hz, peaking bands at 230 Hz, 910 Hz and 3.6 kHz and a
 *  high shelf at 14 kHz, each -12..+12 dB. Web audio builds them from
 *  BiquadFilterNodes (webBackend); the desktop engine (src-tauri/src/eq.rs)
 *  and the Android player (Equalizer.kt) run the same Audio EQ Cookbook
 *  filters on the samples themselves, so a setting sounds alike everywhere.
 *
 *  Every engine puts a pre-amp in front of the filters that takes the
 *  loudest point of the curve back to 0 dB (auto headroom, autoPreampDb), so
 *  a boost never pushes a full-scale song into clipping. Only the switch and
 *  the five gains travel between the app and an engine; each engine works
 *  the headroom out for itself at its own sample rate.
 *
 *  Pure: also used by the plugins API route to check what it stores. */

export const EQ_BANDS = [60, 230, 910, 3600, 14000] as const;
export const EQ_MAX_DB = 12;
/** Q of the three peaking bands (Web Audio's default, set explicitly). */
export const EQ_PEAK_Q = 1;

export type EqPresetId = 'flat' | 'bass' | 'treble' | 'vocal' | 'acoustic' | 'electronic' | 'loudness';

export interface EqSettings {
  enabled: boolean;
  /** Five gains in dB, EQ_BANDS order. */
  bands: number[];
}

export const EQ_PRESETS: readonly { id: EqPresetId; label: string; bands: readonly number[] }[] = [
  { id: 'flat', label: 'Flat', bands: [0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Bass boost', bands: [7, 4, 0, 0, 0] },
  { id: 'treble', label: 'Treble boost', bands: [0, 0, 0, 4, 7] },
  { id: 'vocal', label: 'Vocal', bands: [-2, -1, 3, 4, 1] },
  { id: 'acoustic', label: 'Acoustic', bands: [4, 1, 1, 3, 2] },
  { id: 'electronic', label: 'Electronic', bands: [5, 1, -2, 2, 5] },
  { id: 'loudness', label: 'Loudness', bands: [6, 0, -1, 0, 5] },
];

/** Off and flat: on web audio nothing is built until it is switched on. */
export const DEFAULT_EQ: EqSettings = { enabled: false, bands: [0, 0, 0, 0, 0] };

/** One gain held to the band's range, to the half dB; not a number is 0. */
export function clampBand(db: unknown): number {
  const n = typeof db === 'number' && Number.isFinite(db) ? db : 0;
  const c = Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, n));
  // `+ 0` turns -0 into 0, so a cleared band reads as flat.
  return Math.round(c * 2) / 2 + 0;
}

/** Stored or sent settings, or null when they are not settings at all.
 *  Five numeric bands are required; each is clamped. */
export function parseEq(raw: unknown): EqSettings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== 'boolean' || !Array.isArray(r.bands) || r.bands.length !== EQ_BANDS.length) return null;
  if (!r.bands.every((b) => typeof b === 'number' && Number.isFinite(b))) return null;
  return { enabled: r.enabled, bands: r.bands.map(clampBand) };
}

export function sameEq(a: EqSettings, b: EqSettings): boolean {
  return a.enabled === b.enabled && a.bands.length === b.bands.length && a.bands.every((v, i) => v === b.bands[i]);
}

/** Whether the filters change anything: on, and not flat. */
export function eqActive(eq: EqSettings): boolean {
  return eq.enabled && eq.bands.some((b) => b !== 0);
}

/** The preset these gains are, or null for a custom curve. */
export function presetFor(bands: readonly number[]): EqPresetId | null {
  return EQ_PRESETS.find((p) => p.bands.every((v, i) => v === bands[i]))?.id ?? null;
}

// ── Filter math (Audio EQ Cookbook, the formulas BiquadFilterNode uses) ──

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const IDENTITY: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

/** Kept under Nyquist: a 14 kHz shelf on a 22.05 kHz stream folds over. */
const omega = (fs: number, f0: number) => (2 * Math.PI * Math.min(f0, fs * 0.45)) / fs;

const norm = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad => ({
  b0: b0 / a0,
  b1: b1 / a0,
  b2: b2 / a0,
  a1: a1 / a0,
  a2: a2 / a0,
});

export function peaking(fs: number, f0: number, q: number, db: number): Biquad {
  if (db === 0) return IDENTITY;
  const a = Math.pow(10, db / 40);
  const w = omega(fs, f0);
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  return norm(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
}

/** Shelf slope S = 1, as BiquadFilterNode's lowshelf. */
export function lowShelf(fs: number, f0: number, db: number): Biquad {
  if (db === 0) return IDENTITY;
  const a = Math.pow(10, db / 40);
  const w = omega(fs, f0);
  const cos = Math.cos(w);
  const k = 2 * Math.sqrt(a) * (Math.sin(w) / Math.SQRT2);
  return norm(
    a * (a + 1 - (a - 1) * cos + k),
    2 * a * (a - 1 - (a + 1) * cos),
    a * (a + 1 - (a - 1) * cos - k),
    a + 1 + (a - 1) * cos + k,
    -2 * (a - 1 + (a + 1) * cos),
    a + 1 + (a - 1) * cos - k,
  );
}

/** Shelf slope S = 1, as BiquadFilterNode's highshelf. */
export function highShelf(fs: number, f0: number, db: number): Biquad {
  if (db === 0) return IDENTITY;
  const a = Math.pow(10, db / 40);
  const w = omega(fs, f0);
  const cos = Math.cos(w);
  const k = 2 * Math.sqrt(a) * (Math.sin(w) / Math.SQRT2);
  return norm(
    a * (a + 1 + (a - 1) * cos + k),
    -2 * a * (a - 1 + (a + 1) * cos),
    a * (a + 1 + (a - 1) * cos - k),
    a + 1 - (a - 1) * cos + k,
    2 * (a - 1 - (a + 1) * cos),
    a + 1 - (a - 1) * cos - k,
  );
}

/** One section's gain at `f` Hz, in dB. */
export function magnitudeDb(c: Biquad, fs: number, f: number): number {
  const w = (2 * Math.PI * f) / fs;
  const nr = c.b0 + c.b1 * Math.cos(w) + c.b2 * Math.cos(2 * w);
  const ni = -(c.b1 * Math.sin(w) + c.b2 * Math.sin(2 * w));
  const dr = 1 + c.a1 * Math.cos(w) + c.a2 * Math.cos(2 * w);
  const di = -(c.a1 * Math.sin(w) + c.a2 * Math.sin(2 * w));
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The five sections for these gains. */
export function design(bands: readonly number[], fs: number): Biquad[] {
  return [
    lowShelf(fs, EQ_BANDS[0], bands[0] ?? 0),
    peaking(fs, EQ_BANDS[1], EQ_PEAK_Q, bands[1] ?? 0),
    peaking(fs, EQ_BANDS[2], EQ_PEAK_Q, bands[2] ?? 0),
    peaking(fs, EQ_BANDS[3], EQ_PEAK_Q, bands[3] ?? 0),
    highShelf(fs, EQ_BANDS[4], bands[4] ?? 0),
  ];
}

/** The whole curve's gain at `f` Hz, in dB. */
export function responseDb(sections: Biquad[], fs: number, f: number): number {
  return sections.reduce((sum, s) => sum + magnitudeDb(s, fs, f), 0);
}

/** The pre-amp that brings the curve's loudest point (20 Hz to 20 kHz, or
 *  to just under Nyquist) back to 0 dB. Never above 0: it only makes room. */
export function autoPreampDb(bands: readonly number[], fs = 48000): number {
  const sections = design(bands, fs);
  const lo = 20;
  const hi = Math.min(20000, fs * 0.49);
  const points = 240;
  let peak = -Infinity;
  for (let i = 0; i < points; i++) {
    peak = Math.max(peak, responseDb(sections, fs, lo * Math.pow(hi / lo, i / (points - 1))));
  }
  for (const f of EQ_BANDS) if (f < hi) peak = Math.max(peak, responseDb(sections, fs, f));
  return -Math.max(0, peak) + 0;
}
