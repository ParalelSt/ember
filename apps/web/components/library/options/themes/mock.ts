/** Mock data for the /dizajn "Themes" candidates (Task 0 of
 *  docs/superpowers/plans/2026-09-23-themes.md). `lib/theme/` does not exist
 *  yet (Task 1 builds it), so the five presets' input colours and a
 *  hand-derived subset of the CSS variables they drive are typed inline
 *  here, following the plan's own tables (sections 1b and 2) closely enough
 *  that the swatches are honest. Task 1 freezes the real derivation; this
 *  file is mock-only and nothing outside /dizajn imports it. */

export type Oklch = readonly [l: number, c: number, h: number];

export interface ThemeInputsMock {
  background: Oklch;
  surface: Oklch;
  text: Oklch;
  mutedText: Oklch;
  accent: Oklch;
  accentHover: Oklch;
  border: Oklch;
  sidebar: Oklch;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function fmt(l: number, c: number, h: number, alphaPct?: number): string {
  const L = Math.round(clamp01(l) * 1000) / 1000;
  const C = Math.round(Math.max(0, c) * 1000) / 1000;
  const H = Math.round(((h % 360) + 360) % 360);
  return alphaPct == null ? `oklch(${L} ${C} ${H})` : `oklch(${L} ${C} ${H} / ${alphaPct}%)`;
}

/** `fmt` for a plain `Oklch` tuple, exported so the .tsx candidates never
 *  have to write the literal string "oklch(" themselves (lintRules.test.ts
 *  bans raw `oklch(` in .tsx, and rightly: a component should read a token,
 *  not build a colour function call). */
export function formatOklch([l, c, h]: Oklch): string {
  return fmt(l, c, h);
}

/** A hand-written stand-in for lib/theme/derive.ts (section 1b of the
 *  plan): enough of the 30-odd variables to recolour the mock shell and the
 *  editor's swatches honestly. `emberForegroundOnBackground` is the plan's
 *  Task 1 test case: Forest's amber and Mono's near-white accent both read
 *  the accent-on-text contrast as under 3:1, so the button text falls back
 *  to the background colour instead of white. */
function deriveMock(inputs: ThemeInputsMock, emberForegroundOnBackground: boolean): Record<string, string> {
  const [bgL, bgC, bgH] = inputs.background;
  const [surL, surC, surH] = inputs.surface;
  const [textL, textC, textH] = inputs.text;
  const [mutedL, mutedC, mutedH] = inputs.mutedText;
  const [accL, accC, accH] = inputs.accent;
  const [hovL, hovC, hovH] = inputs.accentHover;
  const [sideL, sideC, sideH] = inputs.sidebar;
  const background = fmt(bgL, bgC, bgH);
  const text = fmt(textL, textC, textH);
  const accent = fmt(accL, accC, accH);
  return {
    '--background': background,
    '--foreground': text,
    '--card-foreground': text,
    '--popover-foreground': text,
    '--primary': text,
    '--secondary-foreground': text,
    '--accent-foreground': text,
    '--sidebar-primary-foreground': text,
    '--sidebar-accent-foreground': text,
    '--surface': fmt(surL, surC, surH),
    '--card': fmt(surL, surC, surH),
    '--surface-2': fmt(surL + 0.04, surC, surH),
    '--muted': fmt(surL + 0.04, surC, surH),
    '--popover': fmt(surL + 0.02, surC * 1.2, surH),
    '--secondary': fmt(surL + 0.06, surC, surH),
    '--accent': fmt(surL + 0.1, surC, surH),
    '--primary-foreground': fmt(bgL + 0.02, bgC, bgH),
    '--muted-foreground': fmt(mutedL, mutedC, mutedH),
    '--border': fmt(1, 0, 0, 8),
    '--input': fmt(1, 0, 0, 12),
    '--sidebar-border': fmt(1, 0, 0, 6),
    '--ember': accent,
    '--ring': accent,
    '--sidebar-primary': accent,
    '--sidebar-ring': accent,
    '--cover-from': accent,
    '--ember-soft': fmt(hovL, hovC, hovH),
    '--cover-to': fmt(0.3, accC * 0.75, accH),
    '--sidebar': fmt(sideL, sideC, sideH),
    '--sidebar-foreground': fmt(textL - 0.03, textC, textH),
    '--sidebar-accent': fmt(sideL + 0.09, sideC, sideH),
    '--destructive': fmt(0.65, 0.22, 25),
    '--ember-foreground': emberForegroundOnBackground ? background : text,
    '--art': fmt(0, 0, 0),
  };
}

export type PresetId = 'ember' | 'midnight' | 'forest' | 'nebula' | 'mono';

export interface ThemePresetMock {
  id: PresetId;
  name: string;
  blurb: string;
  inputs: ThemeInputsMock;
  vars: Record<string, string>;
}

const PRESET_INPUTS: Record<PresetId, ThemeInputsMock> = {
  ember: {
    background: [0.16, 0.005, 260],
    surface: [0.2, 0.005, 260],
    text: [0.98, 0, 0],
    mutedText: [0.7, 0.005, 260],
    accent: [0.68, 0.2, 25],
    accentHover: [0.78, 0.13, 25],
    border: [1, 0, 0],
    sidebar: [0.13, 0.005, 260],
  },
  midnight: {
    background: [0.17, 0.03, 262],
    surface: [0.21, 0.03, 262],
    text: [0.97, 0.01, 250],
    mutedText: [0.7, 0.02, 255],
    accent: [0.75, 0.14, 225],
    accentHover: [0.83, 0.1, 225],
    border: [1, 0, 0],
    sidebar: [0.14, 0.03, 262],
  },
  forest: {
    background: [0.17, 0.02, 150],
    surface: [0.21, 0.02, 150],
    text: [0.97, 0.005, 140],
    mutedText: [0.7, 0.02, 145],
    accent: [0.8, 0.16, 75],
    accentHover: [0.87, 0.12, 80],
    border: [1, 0, 0],
    sidebar: [0.14, 0.02, 150],
  },
  nebula: {
    background: [0.16, 0.03, 300],
    surface: [0.2, 0.03, 300],
    text: [0.97, 0.01, 300],
    mutedText: [0.7, 0.03, 300],
    accent: [0.72, 0.19, 320],
    accentHover: [0.8, 0.14, 320],
    border: [1, 0, 0],
    sidebar: [0.13, 0.03, 300],
  },
  mono: {
    background: [0, 0, 0],
    surface: [0.12, 0, 0],
    text: [0.97, 0, 0],
    mutedText: [0.68, 0, 0],
    accent: [0.97, 0, 0],
    accentHover: [0.85, 0, 0],
    border: [1, 0, 0],
    sidebar: [0, 0, 0],
  },
};

// Only Forest's amber and Mono's near-white accent fail the accent-on-text
// contrast check (plan section 1b, "--ember-foreground"); Ember, Midnight
// and Nebula's accents are dark enough that white text stays readable.
const FLIPS_TO_BACKGROUND: ReadonlySet<PresetId> = new Set(['forest', 'mono']);

const PRESET_META: { id: PresetId; name: string; blurb: string }[] = [
  { id: 'ember', name: 'Ember', blurb: "Today's default: warm red on near-black." },
  { id: 'midnight', name: 'Midnight', blurb: 'Deep blue with an ice-blue accent.' },
  { id: 'forest', name: 'Forest', blurb: 'Dark green with an amber accent.' },
  { id: 'nebula', name: 'Nebula', blurb: 'Violet with a magenta accent.' },
  { id: 'mono', name: 'Mono', blurb: 'Pure black with a white accent, for OLED phones.' },
];

export const THEME_PRESETS: ThemePresetMock[] = PRESET_META.map(({ id, name, blurb }) => ({
  id,
  name,
  blurb,
  inputs: PRESET_INPUTS[id],
  vars: deriveMock(PRESET_INPUTS[id], FLIPS_TO_BACKGROUND.has(id)),
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
  ...PRESET_INPUTS.midnight,
  accent: [0.62, 0.16, 288],
  accentHover: [0.72, 0.12, 288],
};
export const MOCK_CUSTOM_EDITING_VARS = deriveMock(MOCK_CUSTOM_EDITING, false);

export const MOCK_CUSTOM_WARNING: ThemeInputsMock = {
  ...PRESET_INPUTS.midnight,
  accent: [0.24, 0.05, 262],
  accentHover: [0.3, 0.05, 262],
};
export const MOCK_CUSTOM_WARNING_VARS = deriveMock(MOCK_CUSTOM_WARNING, false);

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
