import { contrast, formatOklch, type Oklch } from '@/lib/theme/oklch';
import type { ThemeInputKey, ThemeInputs } from '@/lib/theme/model';

/** Every CSS variable a theme sets (plan section 1b): the `:root` colours
 *  in app/globals.css plus `--ember-foreground` and `--art`. */
export const THEME_VARS = [
  '--background',
  '--foreground',
  '--surface',
  '--surface-2',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--border',
  '--input',
  '--ring',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
  '--ember',
  '--ember-soft',
  '--ember-foreground',
  '--cover-from',
  '--cover-to',
  '--art',
] as const;

export type ThemeVar = (typeof THEME_VARS)[number];
export type ThemeVars = Record<ThemeVar, string>;
export type Scheme = 'dark' | 'light';

export interface DerivedTheme {
  vars: ThemeVars;
  scheme: Scheme;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** Same hue and chroma, lightness shifted (clamped to 0..1). */
const lighten = ([l, c, h]: Oklch, dl: number): Oklch => [clamp01(l + dl), c, h];

export function schemeOf(background: Oklch): Scheme {
  return background[0] < 0.5 ? 'dark' : 'light';
}

const WHITE: Oklch = [1, 0, 0];

/** What goes on the accent (buttons, badges): white, which is what the app
 *  has always put there (`text-white`, about 3.2:1 on Ember's red), while
 *  it reads at 3:1 or better; otherwise the darker of text and background,
 *  which for a light accent (Forest's amber, Mono's white) is the dark
 *  background. */
export function emberForeground(inputs: ThemeInputs): Oklch {
  if (contrast(WHITE, inputs.accent) >= 3) return WHITE;
  return inputs.background[0] <= inputs.text[0] ? inputs.background : inputs.text;
}

/** The full variable set for eight inputs. Ember's inputs reproduce the
 *  `:root` block of app/globals.css value for value (derive.test.ts parses
 *  the file to hold that). */
export function derive(inputs: ThemeInputs): DerivedTheme {
  const { background, surface, text, mutedText, accent, accentHover, border, sidebar } = inputs;
  const scheme = schemeOf(background);
  const f = (c: Oklch) => formatOklch(c);
  const t = f(text);
  const a = f(accent);
  const vars: ThemeVars = {
    '--background': f(background),
    '--foreground': t,
    '--card-foreground': t,
    '--popover-foreground': t,
    '--primary': t,
    '--secondary-foreground': t,
    '--accent-foreground': t,
    '--sidebar-primary-foreground': t,
    '--sidebar-accent-foreground': t,
    '--surface': f(surface),
    '--card': f(surface),
    '--surface-2': f(lighten(surface, 0.04)),
    '--muted': f(lighten(surface, 0.04)),
    '--popover': f([clamp01(surface[0] + 0.02), surface[1] * 1.2, surface[2]]),
    '--secondary': f(lighten(surface, 0.06)),
    '--accent': f(lighten(surface, 0.1)),
    '--primary-foreground': f(lighten(background, 0.02)),
    '--muted-foreground': f(mutedText),
    '--border': formatOklch(border, 8),
    '--input': formatOklch(border, 12),
    '--sidebar-border': formatOklch(border, 6),
    '--ember': a,
    '--ring': a,
    '--sidebar-primary': a,
    '--sidebar-ring': a,
    '--cover-from': a,
    '--ember-soft': f(accentHover),
    '--cover-to': f([0.3, accent[1] * 0.75, accent[2]]),
    '--sidebar': f(sidebar),
    '--sidebar-foreground': f(lighten(text, -0.03)),
    '--sidebar-accent': f(lighten(sidebar, 0.09)),
    // Danger stays the same red in every theme: a warning, not decoration.
    '--destructive': 'oklch(0.65 0.22 25)',
    '--ember-foreground': f(emberForeground(inputs)),
    '--art': scheme === 'dark' ? 'oklch(0 0 0)' : f(lighten(background, -0.08)),
  };
  return { vars, scheme };
}

export type BasicInputs = Pick<ThemeInputs, 'background' | 'accent' | 'text'>;

/** The editor's auto rules: the five "More" colours filled from the three
 *  Basics, except the ones the person pinned, which are kept as given.
 *  Ember's Basics give Ember's own More values back (within 0.005 in L). */
export function autoFill(basics: BasicInputs, pinned: Partial<ThemeInputs> = {}): ThemeInputs {
  const { background, accent, text } = basics;
  const auto: Record<Exclude<ThemeInputKey, keyof BasicInputs>, Oklch> = {
    surface: lighten(background, 0.04),
    sidebar: lighten(background, -0.03),
    mutedText: [clamp01(background[0] + (text[0] - background[0]) * 0.66), background[1], background[2]],
    accentHover: [clamp01(accent[0] + 0.1), accent[1] * 0.65, accent[2]],
    border: schemeOf(background) === 'dark' ? [1, 0, 0] : [0, 0, 0],
  };
  return { ...auto, ...pinned, background, accent, text };
}
