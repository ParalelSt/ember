import { autoFill } from '@/lib/theme/derive';
import { THEME_NAME_MAX, type PresetId, type ThemeDoc, type ThemeInputKey, type ThemeInputs } from '@/lib/theme/model';
import type { Oklch } from '@/lib/theme/oklch';
import { PRESET_BY_ID } from '@/lib/theme/presets';
import type { SavedTheme, SharedTheme, ThemesList } from '@/lib/theme/saved';

/** The Appearance editor's pure half: what is selected, which More colours
 *  follow the Basics, and names for new themes. */

export const MORE_KEYS = ['surface', 'mutedText', 'accentHover', 'border', 'sidebar'] as const satisfies readonly ThemeInputKey[];
export type MoreKey = (typeof MORE_KEYS)[number];

export const isMoreKey = (key: ThemeInputKey): key is MoreKey => (MORE_KEYS as readonly string[]).includes(key);

/** What the page is showing, from the active doc and the list:
 *  - `preset`: a preset as is (editing it saves a new theme of mine),
 *  - `mine`: one of my saved themes (edits save to it),
 *  - `others`: someone else's shared theme (read-only),
 *  - `loose`: colours kept after their original went away (editing saves
 *    them as a new theme of mine),
 *  - `pending`: a saved theme while the list is still loading. */
export type Selection =
  | { key: string; kind: 'preset'; base: PresetId; name: string; inputs: ThemeInputs }
  | { key: string; kind: 'mine'; base: PresetId; name: string; inputs: ThemeInputs; theme: SavedTheme }
  | { key: string; kind: 'others'; base: PresetId; name: string; inputs: ThemeInputs; theme: SharedTheme }
  | { key: string; kind: 'loose' | 'pending'; base: PresetId; name: string; inputs: ThemeInputs };

export function selectionOf(doc: ThemeDoc, list: ThemesList | null): Selection {
  if (doc.themeId) {
    const mine = list?.mine.find((t) => t.id === doc.themeId);
    if (mine) return { key: mine.id, kind: 'mine', base: mine.base, name: mine.name, inputs: mine.inputs, theme: mine };
    const others = list?.shared.find((t) => t.id === doc.themeId);
    if (others) return { key: others.id, kind: 'others', base: others.base, name: others.name, inputs: others.inputs, theme: others };
  }
  const preset = PRESET_BY_ID[doc.preset];
  if (!doc.custom) return { key: `preset:${preset.id}`, kind: 'preset', base: preset.id, name: preset.name, inputs: preset.inputs };
  return {
    key: `${list || !doc.themeId ? 'loose' : 'pending'}:${doc.themeId ?? ''}`,
    kind: list || !doc.themeId ? 'loose' : 'pending',
    base: preset.id,
    name: doc.name ?? 'My theme',
    inputs: doc.custom,
  };
}

function near(a: Oklch, b: Oklch): boolean {
  if (Math.abs(a[0] - b[0]) > 0.006 || Math.abs(a[1] - b[1]) > 0.006) return false;
  if (Math.min(a[1], b[1]) < 0.01) return true;
  const dh = Math.abs(a[2] - b[2]) % 360;
  return Math.min(dh, 360 - dh) <= 2;
}

/** The More colours that do not follow the Basics' auto rules: set by hand
 *  (or by a preset), so changing a Basic leaves them alone. */
export function pinnedOf(inputs: ThemeInputs): Set<MoreKey> {
  const auto = autoFill(inputs);
  return new Set(MORE_KEYS.filter((key) => !near(inputs[key], auto[key])));
}

/** A change to one colour: a Basic re-fills every More colour that is not
 *  pinned; a More colour becomes pinned. */
export function applyChange(
  inputs: ThemeInputs,
  pinned: ReadonlySet<MoreKey>,
  key: ThemeInputKey,
  value: Oklch,
): { inputs: ThemeInputs; pinned: Set<MoreKey> } {
  if (isMoreKey(key)) return { inputs: { ...inputs, [key]: value }, pinned: new Set(pinned).add(key) };
  const next = { ...inputs, [key]: value };
  return { inputs: refill(next, pinned), pinned: new Set(pinned) };
}

/** Every unpinned More colour back on the auto rules. */
export function refill(inputs: ThemeInputs, pinned: ReadonlySet<MoreKey>): ThemeInputs {
  const kept = Object.fromEntries([...pinned].map((key) => [key, inputs[key]])) as Partial<ThemeInputs>;
  return autoFill(inputs, kept);
}

/** `base`, or `base 2`, `base 3`... whichever is free, within 40 characters. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  const fit = (s: string, suffix = '') => s.slice(0, THEME_NAME_MAX - suffix.length).trimEnd() + suffix;
  if (!names.has(fit(base).toLowerCase())) return fit(base);
  for (let i = 2; ; i++) {
    const name = fit(base, ` ${i}`);
    if (!names.has(name.toLowerCase())) return name;
  }
}
