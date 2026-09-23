/** Mock data for the /dizajn "Themes" candidates (Task 0 of
 *  docs/superpowers/plans/2026-09-23-themes.md). The presets and the
 *  derivation are the real ones from lib/theme, so the gallery swatches are
 *  exactly what the app paints; only the saved and shared lists below are
 *  made up. Nothing outside /dizajn imports this file. */

import { derive } from '@/lib/theme/derive';
import type { PresetId, ThemeInputs } from '@/lib/theme/model';
import { formatOklch as formatCss, type Oklch } from '@/lib/theme/oklch';
import { PRESET_BY_ID, PRESETS } from '@/lib/theme/presets';

export type { Oklch, PresetId };
export type ThemeInputsMock = ThemeInputs;

/** `formatOklch` from lib/theme for a plain tuple, re-exported so the .tsx
 *  candidates never have to write the literal string "oklch(" themselves
 *  (lintRules.test.ts bans raw `oklch(` in .tsx, and rightly: a component
 *  should read a token, not build a colour function call). */
export function formatOklch(color: Oklch): string {
  return formatCss(color);
}

const varsOf = (inputs: ThemeInputs): Record<string, string> => ({ ...derive(inputs).vars });

export interface ThemePresetMock {
  id: PresetId;
  name: string;
  blurb: string;
  inputs: ThemeInputsMock;
  vars: Record<string, string>;
}

export const THEME_PRESETS: ThemePresetMock[] = PRESETS.map(({ id, name, description, inputs }) => ({
  id,
  name,
  blurb: description,
  inputs,
  vars: varsOf(inputs),
}));

export const THEME_PRESET_BY_ID: Record<PresetId, ThemePresetMock> = Object.fromEntries(
  THEME_PRESETS.map((p) => [p.id, p]),
) as Record<PresetId, ThemePresetMock>;

/** A theme someone has actually customised: Midnight nudged towards a
 *  brighter, more violet accent, used by the "editing" and "warning"
 *  gallery states. In "warning" the accent is pushed close to the
 *  background's own hue and lightness, which is what makes accent-on-
 *  background (links, the active nav item) fail the readability guard. */
export const MOCK_CUSTOM_EDITING: ThemeInputsMock = {
  ...PRESET_BY_ID.midnight.inputs,
  accent: [0.62, 0.16, 288],
  accentHover: [0.72, 0.12, 288],
};
export const MOCK_CUSTOM_EDITING_VARS = varsOf(MOCK_CUSTOM_EDITING);

export const MOCK_CUSTOM_WARNING: ThemeInputsMock = {
  ...PRESET_BY_ID.midnight.inputs,
  accent: [0.24, 0.05, 262],
  accentHover: [0.3, 0.05, 262],
};
export const MOCK_CUSTOM_WARNING_VARS = varsOf(MOCK_CUSTOM_WARNING);

export interface MockSavedTheme {
  id: string;
  name: string;
  base: PresetId;
  shared: boolean;
  vars: Record<string, string>;
}

/** "My themes": the saved list (owner decision 4), not one slot. One is
 *  shared with everyone already (the toggle is on), one is not. */
export const MOCK_MY_THEMES: MockSavedTheme[] = [
  { id: 'sunset', name: 'Sunset drive', base: 'midnight', shared: true, vars: MOCK_CUSTOM_EDITING_VARS },
  { id: 'late-shift', name: 'Late shift', base: 'forest', shared: false, vars: THEME_PRESET_BY_ID.forest.vars },
];

export interface MockSharedTheme {
  id: string;
  name: string;
  ownerName: string;
  vars: Record<string, string>;
}

/** "Shared by others": community themes visible to anyone on this Ember
 *  server, labelled "by <name>" (owner decision 3). */
export const MOCK_SHARED_THEMES: MockSharedTheme[] = [
  { id: 'cold-brew', name: 'Cold brew', ownerName: 'Luka', vars: THEME_PRESET_BY_ID.nebula.vars },
  { id: 'campfire', name: 'Campfire', ownerName: 'Iva', vars: THEME_PRESET_BY_ID.mono.vars },
];
