/** The sync nudge in the listener's own units (the tab page's Sync row):
 *  seconds, or beats of the tab itself. A tab whose first bar comes two
 *  bars late is easier to fix as "-8 beats" than as "-3.87 s". Pure, so the
 *  unit tests need no page. */

import { clampOffset, MAX_OFFSET_MS } from '@/lib/tabSync';

export type OffsetUnit = 'seconds' | 'beats';

/** What a beat is for this tab: its opening tempo (quarter notes per
 *  minute, as AlphaTab and Guitar Pro count it) and time signature. */
export interface BeatClock {
  bpm: number;
  numerator: number;
  denominator: number;
}

/** 4/4 at the tab's tempo when the file names no signature. */
export function beatClockOf(tempo: number | null | undefined, signature?: { numerator: number; denominator: number } | null): BeatClock | null {
  if (!tempo || !Number.isFinite(tempo) || tempo <= 0) return null;
  const numerator = signature && signature.numerator > 0 ? signature.numerator : 4;
  const denominator = signature && signature.denominator > 0 ? signature.denominator : 4;
  return { bpm: tempo, numerator, denominator };
}

/** One beat in milliseconds: the signature's beat unit (a quarter in 4/4,
 *  an eighth in 6/8) at the tab's quarter-note tempo. */
export function beatMs(clock: BeatClock): number {
  return (60_000 / clock.bpm) * (4 / clock.denominator);
}

export function beatsToMs(beats: number, clock: BeatClock): number {
  return beats * beatMs(clock);
}

export function msToBeats(ms: number, clock: BeatClock): number {
  return ms / beatMs(clock);
}

/** The nudge from a number typed in `unit`, clamped and rounded the way
 *  every nudge is (lib/tabSync.ts clampOffset). Null for something that is
 *  not a number, or beats with no tempo to count them by. */
export function offsetFromInput(text: string, unit: OffsetUnit, clock: BeatClock | null): number | null {
  const n = Number(String(text).trim().replace(',', '.').replace(/^\+/, ''));
  if (!String(text).trim() || !Number.isFinite(n)) return null;
  if (unit === 'beats') return clock ? clampOffset(beatsToMs(n, clock)) : null;
  return clampOffset(n * 1000);
}

/** The nudge as the number shown in the input: seconds to the hundredth,
 *  beats to the hundredth of a beat, no trailing zeros. */
export function offsetInUnit(ms: number, unit: OffsetUnit, clock: BeatClock | null): number {
  const v = unit === 'beats' && clock ? msToBeats(ms, clock) : ms / 1000;
  return Math.round(v * 100) / 100;
}

/** "+1.25 s", "-8 beats", "0 s". */
export function formatOffset(ms: number, unit: OffsetUnit, clock: BeatClock | null): string {
  const u = unit === 'beats' && clock ? 'beats' : 'seconds';
  const v = offsetInUnit(ms, u, clock);
  const sign = v > 0 ? '+' : '';
  if (u === 'beats') return `${sign}${v} ${Math.abs(v) === 1 ? 'beat' : 'beats'}`;
  return `${sign}${v} s`;
}

/** The slider's reach either way, in seconds: a minute around zero, and
 *  always far enough to show where the nudge is now (in half minutes), so
 *  a big nudge typed into the box still sits on the slider. */
export function sliderSpanSec(ms: number): number {
  const need = Math.ceil(Math.abs(ms) / 1000 / 30) * 30;
  return Math.min(MAX_OFFSET_MS / 1000, Math.max(60, need));
}

/** The nudge buttons in each unit: small and big steps, in ms. */
export function nudgeSteps(unit: OffsetUnit, clock: BeatClock | null): { label: string; ms: number }[] {
  if (unit === 'beats' && clock) {
    const beat = beatMs(clock);
    const bar = beat * clock.numerator;
    return [
      { label: '-1 bar', ms: -bar },
      { label: '-1 beat', ms: -beat },
      { label: '+1 beat', ms: beat },
      { label: '+1 bar', ms: bar },
    ];
  }
  return [
    { label: '-1 s', ms: -1000 },
    { label: '-0.1 s', ms: -100 },
    { label: '+0.1 s', ms: 100 },
    { label: '+1 s', ms: 1000 },
  ];
}
