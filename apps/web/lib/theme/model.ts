import { roundOklch, type Oklch } from '@/lib/theme/oklch';
import { EMBER_INPUTS, PRESET_BY_ID } from '@/lib/theme/presets';

/** The eight colours a person edits (plan section 1a). Naming trap:
 *  "accent" here is the brand colour, `--ember`. shadcn's own `--accent`
 *  is a hover surface, derived from `surface` (see derive.ts). */
export interface ThemeInputs {
  background: Oklch;
  surface: Oklch;
  text: Oklch;
  mutedText: Oklch;
  accent: Oklch;
  accentHover: Oklch;
  border: Oklch;
  sidebar: Oklch;
}

export type ThemeInputKey = keyof ThemeInputs;

export const INPUT_KEYS: readonly ThemeInputKey[] = [
  'background',
  'surface',
  'text',
  'mutedText',
  'accent',
  'accentHover',
  'border',
  'sidebar',
];

/** The three the editor shows first; the other five auto-fill from them. */
export const BASIC_KEYS = ['background', 'accent', 'text'] as const satisfies readonly ThemeInputKey[];

export const PRESET_IDS = ['ember', 'midnight', 'forest', 'nebula', 'mono'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const THEME_NAME_MAX = 40;

/** The ACTIVE theme, as the account stores it in `users.theme` and the
 *  client caches it. It is always self-contained: a saved theme's colours
 *  are copied in, so the root layout can paint it from the cookie record
 *  alone, and deleting or unsharing the original leaves this copy working. */
export interface ThemeDoc {
  v: 1;
  /** The preset in use, or the one a saved theme started from. */
  preset: PresetId;
  /** A saved theme's colours; wins over `preset` when present. */
  custom?: ThemeInputs;
  /** The saved theme's name (max 40 characters). */
  name?: string;
  /** The `themes` row the colours were copied from (mine or shared). */
  themeId?: string;
}

export const DEFAULT_THEME: ThemeDoc = { v: 1, preset: 'ember' };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);
}

/** Why one colour is unusable, or null when it is a valid [l, c, h]. */
function oklchProblem(v: unknown): string | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return 'expected [lightness, chroma, hue]';
  }
  const [l, c, h] = v as number[];
  if (l! < 0 || l! > 1) return 'lightness out of range';
  if (c! < 0 || c! > 0.4) return 'chroma out of range';
  if (h! < 0 || h! > 360) return 'hue out of range';
  return null;
}

/** Strict: all eight colours present and in range, or the first problem as
 *  `'accent: lightness out of range'`. Values come back at storage
 *  precision. Used by the routes, which refuse anything they would have to
 *  repair. */
export function validateInputs(raw: unknown): { ok: true; inputs: ThemeInputs } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'inputs: expected an object with the eight colours' };
  const out = {} as Record<ThemeInputKey, Oklch>;
  for (const key of INPUT_KEYS) {
    if (!(key in raw)) return { ok: false, error: `${key}: missing` };
    const problem = oklchProblem(raw[key]);
    if (problem) return { ok: false, error: `${key}: ${problem}` };
    out[key] = roundOklch(raw[key] as Oklch);
  }
  return { ok: true, inputs: out };
}

/** A theme name trimmed to one line, or null when empty or too long. */
export function cleanThemeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length === 0 || name.length > THEME_NAME_MAX) return null;
  return name;
}

const RECORD_ID = /^[a-z0-9]{15}$/;

export function isRecordId(v: unknown): v is string {
  return typeof v === 'string' && RECORD_ID.test(v);
}

/** Never throws. A wrong version or a non-object is the default; after
 *  that each field falls back on its own: an unknown preset is Ember, a bad
 *  colour in `custom` is the preset's colour, a bad name or id is dropped. */
export function parseThemeDoc(raw: unknown): ThemeDoc {
  if (!isRecord(raw) || raw.v !== 1) return DEFAULT_THEME;
  const preset = isPresetId(raw.preset) ? raw.preset : 'ember';
  const doc: ThemeDoc = { v: 1, preset };
  if (isRecord(raw.custom)) {
    const base = PRESET_BY_ID[preset].inputs;
    const custom = {} as Record<ThemeInputKey, Oklch>;
    for (const key of INPUT_KEYS) {
      const value = raw.custom[key];
      custom[key] = oklchProblem(value) ? base[key] : roundOklch(value as Oklch);
    }
    doc.custom = custom;
  }
  const name = cleanThemeName(raw.name);
  if (name) doc.name = name;
  if (isRecordId(raw.themeId)) doc.themeId = raw.themeId;
  return doc;
}

/** The colours in effect: the saved copy, else the preset's. */
export function resolveInputs(doc: ThemeDoc): ThemeInputs {
  return doc.custom ?? PRESET_BY_ID[doc.preset].inputs;
}

export function sameInputs(a: ThemeInputs, b: ThemeInputs): boolean {
  return INPUT_KEYS.every((key) => {
    const x = roundOklch(a[key]);
    const y = roundOklch(b[key]);
    return x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
  });
}

/** True when the colours are Ember's: the "apply no overrides" case. */
export function isDefault(doc: ThemeDoc): boolean {
  return sameInputs(resolveInputs(doc), EMBER_INPUTS);
}

/** Two docs that would paint and label the page the same way. */
export function sameDoc(a: ThemeDoc, b: ThemeDoc): boolean {
  return (
    a.preset === b.preset &&
    a.name === b.name &&
    a.themeId === b.themeId &&
    !!a.custom === !!b.custom &&
    sameInputs(resolveInputs(a), resolveInputs(b))
  );
}
