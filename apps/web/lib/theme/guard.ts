import { contrast, type Oklch } from '@/lib/theme/oklch';
import { emberForeground } from '@/lib/theme/derive';
import type { ThemeInputKey, ThemeInputs } from '@/lib/theme/model';

/** The readability guard (plan section 5, item 4): six pairs the app leans
 *  on, each rated by WCAG contrast. A `fail` blocks saving a theme to the
 *  account; nothing is ever adjusted silently, a finding only offers a
 *  `fix` the person can apply. */
export type PairId = 'text' | 'hover' | 'muted' | 'button' | 'accent' | 'sidebar';
export type Level = 'ok' | 'warn' | 'fail';

export interface Finding {
  pair: PairId;
  /** Plain words for the UI, e.g. "Muted text on cards". */
  label: string;
  ratio: number;
  level: Level;
  /** The inputs with one colour's lightness moved just far enough to lift
   *  the pair a level (fail to warn, warn to ok). Absent when ok, or when
   *  20 steps of 0.02 cannot get there. Chroma and hue are never changed. */
  fix?: ThemeInputs;
}

interface Pair {
  id: PairId;
  label: string;
  fg: (i: ThemeInputs) => Oklch;
  bg: (i: ThemeInputs) => Oklch;
  /** At or above: ok. */
  ok: number;
  /** At or above (and under `ok`): warn. Below: fail. */
  warn: number;
  /** The input "Fix it" moves. */
  moves: ThemeInputKey;
}

const shift = ([l, c, h]: Oklch, dl: number): Oklch => [Math.min(1, Math.max(0, l + dl)), c, h];

export const PAIRS: readonly Pair[] = [
  { id: 'text', label: 'Text on the background', fg: (i) => i.text, bg: (i) => i.background, ok: 7, warn: 4.5, moves: 'text' },
  { id: 'hover', label: 'Text on highlighted rows', fg: (i) => i.text, bg: (i) => shift(i.surface, 0.04), ok: 7, warn: 4.5, moves: 'surface' },
  { id: 'muted', label: 'Muted text on cards', fg: (i) => i.mutedText, bg: (i) => i.surface, ok: 4.5, warn: 3, moves: 'mutedText' },
  // Buttons use the 3:1 bar for bold and large text with no warn band:
  // white on Ember's red is about 3.2:1 and Ember stays exactly as it is.
  { id: 'button', label: 'Button text on the accent', fg: emberForeground, bg: (i) => i.accent, ok: 3, warn: 3, moves: 'accent' },
  { id: 'accent', label: 'Accent links on the background', fg: (i) => i.accent, bg: (i) => i.background, ok: 4.5, warn: 3, moves: 'accent' },
  { id: 'sidebar', label: 'Sidebar text', fg: (i) => shift(i.text, -0.03), bg: (i) => i.sidebar, ok: 7, warn: 4.5, moves: 'sidebar' },
];

function levelOf(pair: Pair, ratio: number): Level {
  if (ratio >= pair.ok) return 'ok';
  return ratio >= pair.warn ? 'warn' : 'fail';
}

const rank: Record<Level, number> = { fail: 0, warn: 1, ok: 2 };

function findFix(pair: Pair, inputs: ThemeInputs, from: Level): ThemeInputs | undefined {
  const want = from === 'fail' ? 'warn' : 'ok';
  let best: { steps: number; inputs: ThemeInputs } | undefined;
  const [l, c, h] = inputs[pair.moves];
  // Both directions, the shorter move wins: usually "away from the
  // partner", but a colour already at 0 or 1 can only go the other way.
  for (const dir of [1, -1]) {
    for (let step = 1; step <= 20; step++) {
      const moved = Math.round(Math.min(1, Math.max(0, l + dir * 0.02 * step)) * 1000) / 1000;
      const candidate: ThemeInputs = { ...inputs, [pair.moves]: [moved, c, h] };
      const level = levelOf(pair, contrast(pair.fg(candidate), pair.bg(candidate)));
      if (rank[level] >= rank[want]) {
        if (!best || step < best.steps) best = { steps: step, inputs: candidate };
        break;
      }
      if (moved === 0 || moved === 1) break;
    }
  }
  return best?.inputs;
}

/** One finding per pair, ok ones included. */
export function checkTheme(inputs: ThemeInputs): Finding[] {
  return PAIRS.map((pair) => {
    const ratio = contrast(pair.fg(inputs), pair.bg(inputs));
    const level = levelOf(pair, ratio);
    const finding: Finding = { pair: pair.id, label: pair.label, ratio: Math.round(ratio * 10) / 10, level };
    if (level !== 'ok') {
      const fix = findFix(pair, inputs, level);
      if (fix) finding.fix = fix;
    }
    return finding;
  });
}

/** The findings worth showing: warn and fail. */
export function problems(inputs: ThemeInputs): Finding[] {
  return checkTheme(inputs).filter((f) => f.level !== 'ok');
}

/** True when any pair fails, which blocks saving to the account. */
export function isUnreadable(inputs: ThemeInputs): boolean {
  return checkTheme(inputs).some((f) => f.level === 'fail');
}
